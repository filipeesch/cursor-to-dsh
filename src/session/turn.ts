/**
 * One host model call, end to end, on a persistent Cursor session.
 *
 * - The first send carries the system prompt and the history; later sends carry only the new
 *   user and context text, so Cursor's prompt cache covers the whole conversation.
 * - A host tool call keeps the Cursor run alive: the custom tool's `execute` waits until the host
 *   sends the result back on the next call, so the model sees a normal tool result.
 * - Tools changed mid-session keep the agent: every send carries the current tools, and system
 *   prompt lines that were only added are prepended to the next send. A run waiting for tool
 *   results is cancelled and continued with the new tools.
 * - Anything else that does not match what Cursor saw starts a new agent from the full history,
 *   so correctness never depends on the cache.
 * - Tool calls are delivered as soon as the collection window allows. The window starts at zero
 *   and is learned per model from siblings that missed their delivery, so a delivery never waits
 *   for a fixed period and never waits for a usage report.
 */
import { debug } from "../debug.ts";
import type { ContextTierStore } from "../cursor/context-tier.ts";
import { isRejectedParams, smallerContext } from "../model-tiers.ts";
import { modelParams } from "../model-params.ts";
import { resolveModelId, type Param } from "../model-catalog.ts";
import { maxModeFor } from "../policy/model-config.ts";
import type { ModelPolicy } from "../policy/types.ts";
import { currentTurnImages, imagesOf, textOf } from "../prompt/content.ts";
import { fingerprint, hash } from "../prompt/fingerprint.ts";
import { renderTranscript, systemPromptAddition, toolResultForCursor } from "../prompt/render.ts";
import { ERROR_CODES, Reply } from "../reply.ts";
import type { Transcript } from "../transcript.ts";
import { toTokenUsage } from "../usage.ts";
import type { HandoffWindow } from "./handoff-window.ts";
import { planIncrement, type Results } from "./increment.ts";
import { ANON_PREFIX, type SessionRegistry } from "./registry.ts";
import { CursorSession } from "./session.ts";
import { StepTiming, type StepNote, type StepOutcome, type TimingDeps } from "./timing.ts";
import { addedToolsNote, syncTools, toolsKeyOf } from "./tools.ts";
import type { StallInfo } from "./watchdog.ts";

const CANCEL_WAIT_MS = 15_000;

export interface TurnModel {
  id: string;
  cursorParameters?: unknown;
}

export interface TurnServices {
  createAgent: (opts: any) => Promise<any>;
  registry: SessionRegistry;
  tiers: ContextTierStore;
  /** How long one tool-call delivery may hold, per model. */
  handoff: HandoffWindow;
  /** Per-step timing; disabled unless the operator enabled it. */
  timing: TimingDeps;
  /** Reads the policy from the configuration as it currently stands. */
  readPolicy: () => ModelPolicy;
  /** Inactivity window for one run; 0 disables it. */
  stallTimeoutMs: number;
  onStall?: (session: CursorSession, info: StallInfo) => void;
}

export interface TurnOptions {
  model: TurnModel;
  transcript: Transcript;
  reasoning?: string;
  signal?: AbortSignal;
  apiKey: string | undefined;
  sessionKey: string;
  cwd: string;
  reply: Reply;
}

function signatureOf(modelId: string, params: Param[] | undefined): string {
  return hash(JSON.stringify([modelId, params ?? []]));
}

function stallMessage(modelId: string, info: StallInfo): string {
  const seconds = Math.round(info.elapsedMs / 1000);
  return `Cursor produced no content for ${seconds}s on model "${modelId}" (last frame: ${info.lastEvent}); the run was abandoned. Set DSH_CURSOR_STALL_TIMEOUT_MS or the stallTimeoutMs option to change the window.`;
}

/**
 * Report the open call's usage only when the provider already sent it.
 * A report that has not arrived by now belongs to the run's end, not to this call.
 */
function reportArrivedUsage(reply: Reply, session: CursorSession): void {
  const usage = session.ledger.take();
  session.ledger.end();
  // The provider reports once per run, over every call it served: describe one request.
  if (usage) reply.usage = toTokenUsage(usage, session.modelCalls);
}

async function openSession(
  key: string,
  modelId: string,
  params: Param[] | undefined,
  maxMode: boolean,
  t: Transcript,
  apiKey: string,
  cwd: string,
  services: TurnServices,
): Promise<CursorSession> {
  const s = new CursorSession(key, signatureOf(modelId, params), params, {
    modelId,
    onIdle: (session) => services.registry.drop(session),
    stallTimeoutMs: services.stallTimeoutMs,
    onStall: services.onStall,
    onLateSibling: (session, gapMs) => services.handoff.observe(session.modelId, gapMs),
  });
  s.systemPrompt = t.systemPrompt;
  const { local } = syncTools(s, t.tools);
  s.agent = await services.createAgent({
    model: {
      id: modelId,
      ...(params?.length ? { params } : {}),
      // Only an explicit policy turns on the provider's extended-context mode.
      ...(maxMode ? { maxMode: true } : {}),
    },
    apiKey,
    // Always "mcp": host tools are MCP custom tools, and tools can be added later.
    tools: ["mcp"],
    local: { cwd, settingSources: [], customTools: local?.customTools },
  });
  services.registry.store(s);
  return s;
}

/** What a cancelled-and-continued run cost the host. */
interface Continuation {
  continued: boolean;
  sentChars: number;
}

/**
 * Cursor fixes a run's tools when it starts. Cancel the waiting run and deliver its tool
 * results in a follow-up send that carries the new tools. Not continued if the run would
 * not stop.
 */
async function continueWithNewTools(
  s: CursorSession,
  results: Results,
  tools: any[],
  note: string,
  send: (s: CursorSession, text: string, images: any[] | undefined, options: any) => Promise<any>,
): Promise<Continuation> {
  settle(() => void Promise.resolve(s.run?.cancel?.()).catch(() => {}));
  const deadline = Date.now() + CANCEL_WAIT_MS;
  while (!s.runDone && Date.now() < deadline) await s.waitForChange(deadline - Date.now());
  if (!s.runDone) return { continued: false, sentChars: 0 };
  for (const p of s.pending) settle(() => p.resolve({ content: [{ type: "text", text: "Delivered in the next message." }], isError: false }));
  s.pending = [];
  const parts = ["[Tool results for your last tool calls. The run was restarted because the host's tools or system prompt changed; the tools on this request are current.]"];
  for (const r of results) {
    parts.push(`### ${r.call.name} (${r.call.id})${r.message.isError ? " [error]" : ""}\n${textOf(r.message?.content) || "(no output)"}`);
    if (r.extra) parts.push(r.extra);
  }
  if (note) parts.push(note);
  const added = addedToolsNote(s, tools);
  if (added) parts.push(added);
  parts.push("Continue the task.");
  const text = parts.join("\n\n");
  s.ledger.begin();
  s.startRun(await send(s, text, imagesOf(results.map((r) => r.message)), syncTools(s, tools)));
  return { continued: true, sentChars: text.length };
}

function settle(fn: () => void): void {
  try {
    fn();
  } catch {
    /* best effort */
  }
}

/** Run one host model call on a persistent Cursor session; every chunk goes to `reply`. */
export async function runTurn(options: TurnOptions, services: TurnServices): Promise<void> {
  const { model, apiKey, sessionKey, cwd, reply, signal } = options;
  const t = options.transcript;
  const { registry, tiers, handoff, timing } = services;
  const policy = services.readPolicy();
  const modelId = resolveModelId(model.id);

  const step = timing.enabled() ? new StepTiming(sessionKey, modelId, handoff.windowFor(modelId)) : undefined;
  let recorded = false;
  const finishStep = (outcome: StepOutcome, note?: StepNote): void => {
    if (!step || recorded) return;
    recorded = true;
    if (note) step.note(note);
    try {
      timing.write(step.finish(outcome));
    } catch {
      // A recorder that fails never changes how a call ends.
    }
  };

  if (!apiKey) {
    finishStep("error");
    return reply.finish("error", "No Cursor API key. Store CURSOR_API_KEY in DSH credentials or export it before launching DSH.", ERROR_CODES.missingKey);
  }

  const accepted = tiers.get(modelId);
  const params = modelParams(model, options.reasoning, policy, accepted, modelId);
  const signature = signatureOf(modelId, params);

  /** The full history as one text, rendered at most once per call. */
  let fullText: string | undefined;
  const rendered = (): string => (fullText ??= renderTranscript(t.systemPrompt, t.messages));
  const send = async (s: CursorSession, text: string, images: any[] | undefined, sendOptions: any) => {
    // The SDK's per-update callback is the only source of step duration and token volume, so it
    // is attached only while telemetry is enabled, and routed to the call that is open now.
    const outgoing = step ? { ...sendOptions, onDelta: ({ update }: any) => s.deltaSink?.(update) } : sendOptions;
    return s.agent.send(images?.length ? { text, images } : text, outgoing);
  };
  const sendFirst = async (s: CursorSession, text: string) => {
    s.sentFirst = true;
    s.ledger.begin();
    s.startRun(await send(s, text, currentTurnImages(t.messages), {}));
    step?.sent();
    step?.note({ sentChars: text.length });
  };

  let s = registry.find(sessionKey, signature);
  const lateGap = s?.takeLateSibling() ?? 0;
  if (lateGap) step?.note({ lateSiblingMs: lateGap });
  // One fingerprint pass answers both "did the host rewrite the history" and what Cursor has seen.
  const fingerprints = t.messages.map(fingerprint);
  let plan = planIncrement(s, t.messages, fingerprints);
  let note = "";
  if (s && plan.kind !== "fresh") {
    const addition = systemPromptAddition(s.systemPrompt, t.systemPrompt);
    if (addition === undefined) plan = { kind: "fresh" };
    else note = addition;
  }
  debug(`turn key=${sessionKey.slice(0, 12)} msgs=${t.messages.length} seen=${s?.seen.length ?? "-"} plan=${plan.kind} window=${handoff.windowFor(modelId)}ms`);
  if (s && plan.kind === "fresh") {
    registry.drop(s);
    s = undefined;
  }

  let freshRun = false;
  let emitted = false;
  // One settle tick per call: the provider's own frames reach the transducer through the run
  // stream, so a delivery must not outrun the content that belongs to the same turn.
  let settled = false;
  const onAbort = () => s?.wake();
  // Each call owns its recorder: pointing the session at it replaces the previous call's counters
  // wholesale, so nothing has to be reset in the right order.
  const pointDeltaSink = (session: CursorSession): void => {
    session.deltaSink = step ? (update: any) => step.noteDelta(update) : undefined;
  };
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    if (!s || plan.kind === "fresh") {
      const started = Date.now();
      s = await openSession(sessionKey, modelId, params, maxModeFor(policy, modelId) === "on", t, apiKey, cwd, services);
      const created = Date.now();
      s.busy = true;
      pointDeltaSink(s);
      await sendFirst(s, rendered());
      debug(`fresh key=${sessionKey.slice(0, 12)} create=${created - started}ms send=${Date.now() - created}ms chars=${rendered().length} tools=${t.tools.length}`);
      freshRun = true;
    } else if (plan.kind === "send") {
      s.busy = true;
      step?.reuse();
      const text = [note, addedToolsNote(s, t.tools), plan.text].filter(Boolean).join("\n\n");
      pointDeltaSink(s);
      s.ledger.begin();
      s.startRun(await send(s, text, plan.images, syncTools(s, t.tools)));
      step?.sent();
      step?.note({ sentChars: text.length });
      s.systemPrompt = t.systemPrompt;
    } else if (note || s.toolsKey !== toolsKeyOf(t.tools)) {
      s.busy = true;
      debug(`tools or system prompt changed mid-run key=${sessionKey.slice(0, 12)}`);
      pointDeltaSink(s);
      const continuation = await continueWithNewTools(s, plan.results, t.tools, note, send);
      if (continuation.continued) {
        step?.reuse();
        step?.sent();
        step?.note({ sentChars: continuation.sentChars });
        s.systemPrompt = t.systemPrompt;
      } else {
        registry.drop(s);
        s = await openSession(sessionKey, modelId, params, maxModeFor(policy, modelId) === "on", t, apiKey, cwd, services);
        s.busy = true;
        pointDeltaSink(s);
        await sendFirst(s, rendered());
        freshRun = true;
      }
    } else {
      s.busy = true;
      step?.reuse();
      pointDeltaSink(s);
      s.ledger.begin();
      let sentChars = 0;
      for (const r of plan.results) {
        s.pending = s.pending.filter((p) => p !== r.call);
        sentChars += textOf(r.message?.content).length;
        r.call.resolve(toolResultForCursor(r.message, r.extra));
      }
      step?.sent();
      step?.note({ sentChars });
    }
    s.modelCalls += 1;
    s.touch();
    // A stall belongs to the run that stopped producing, never to the call that follows it.
    s.stall = undefined;
    s.watchdog.resume();
    // What Cursor has now seen; this call's reply is appended when it ends.
    s.seen = [...fingerprints];

    for (;;) {
      while (s.eventCursor < s.events.length) {
        const msg = s.events[s.eventCursor++];
        if (msg?.type === "thinking") {
          reply.thinking(msg.text);
          if (msg.text) {
            step?.content();
            step?.chunk("thinking");
          }
          emitted ||= Boolean(msg.text);
        } else if (msg?.type === "assistant") {
          for (const b of msg.message?.content ?? []) {
            if (b?.type === "text" && b.text) {
              reply.text(b.text);
              step?.content();
              step?.chunk("text");
              emitted = true;
            }
          }
        }
      }
      // Everything queued was delivered; drop the batch so a long run cannot grow without bound.
      if (s.eventCursor > 0 && s.eventCursor >= s.events.length) {
        s.events.length = 0;
        s.eventCursor = 0;
      }
      if (signal?.aborted) {
        registry.drop(s);
        finishStep("aborted");
        return reply.finish("aborted");
      }
      if (s.stall) {
        const info = s.stall;
        registry.drop(s);
        finishStep("stalled");
        return reply.finish("error", stallMessage(modelId, info), ERROR_CODES.stalled);
      }

      const fresh = s.pending.filter((p) => !p.handed);
      if (fresh.length) {
        // The handoff window is the plugin's own delay, not provider silence: stop the monitor
        // before waiting, so a healthy tool turn can never be reported as a stall.
        s.watchdog.suspend();
        // Zero by default; a model that delivered a sibling late gets a window that covers it.
        const wait = s.lastCallAt + handoff.windowFor(modelId) - Date.now();
        if (wait > 0) {
          await s.waitForChange(wait);
          continue;
        }
        if (!settled) {
          // Let the pump forward the frames this turn already produced before closing it. A
          // macrotask, not a wake: a wake is exactly what a half-delivered turn looks like.
          settled = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          continue;
        }
        for (const p of fresh) p.handed = true;
        reply.toolCalls(fresh.map((p) => ({ id: p.id, name: p.name, arguments: p.args })));
        reportArrivedUsage(reply, s);
        s.noteDelivery();
        reply.finish("toolUse");
        s.seen.push(fingerprint(reply.message));
        finishStep("tool-calls", { tools: fresh.length, usage: reply.usage });
        return;
      }

      if (!s.runDone) {
        await s.waitForChange();
        continue;
      }

      const result = s.runResult;
      const status = result?.status ?? (s.runError ? "error" : "finished");
      if (status === "finished") {
        reportArrivedUsage(reply, s);
        s.run = undefined;
        reply.finish("stop");
        s.seen.push(fingerprint(reply.message));
        if (sessionKey.startsWith(ANON_PREFIX)) registry.drop(s);
        finishStep("stop", { usage: reply.usage });
        return;
      }

      const error = result?.error?.message ?? (s.runError instanceof Error ? s.runError.message : s.runError ? String(s.runError) : undefined);
      const lower = freshRun && !emitted && isRejectedParams(error) ? smallerContext(model, s.params) : undefined;
      if (lower) {
        const next = lower.find((p) => p.id === "context");
        if (next) tiers.set(modelId, next.value);
        registry.drop(s);
        s = await openSession(sessionKey, modelId, lower, maxModeFor(policy, modelId) === "on", t, apiKey, cwd, services);
        s.busy = true;
        pointDeltaSink(s);
        await sendFirst(s, rendered());
        s.seen = [...fingerprints];
        continue;
      }
      registry.drop(s);
      finishStep(status === "cancelled" ? "aborted" : "error");
      return reply.finish(status === "cancelled" ? "aborted" : "error", error);
    }
  } catch (err) {
    if (s) registry.drop(s);
    finishStep(signal?.aborted ? "aborted" : "error");
    reply.finish(signal?.aborted ? "aborted" : "error", err instanceof Error ? err.message : String(err));
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
    if (s) {
      s.busy = false;
      if (!s.closed) s.touch();
    }
    finishStep(signal?.aborted ? "aborted" : "error");
    reply.finish("error", "Cursor turn ended without a result");
  }
}
