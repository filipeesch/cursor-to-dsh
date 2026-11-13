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
 */
import { debug } from "../debug.ts";
import type { ContextTierStore } from "../cursor/context-tier.ts";
import {
  isRejectedParams,
  modelParams,
  resolveModelId,
  smallerContext,
  type ModelPolicy,
  type Param,
} from "../models.ts";
import { currentTurnImages, imagesOf, textOf } from "../prompt/content.ts";
import { fingerprint, hash } from "../prompt/fingerprint.ts";
import { renderTranscript, systemPromptAddition, toolResultForCursor } from "../prompt/render.ts";
import { ERROR_CODES, Reply } from "../reply.ts";
import type { Transcript } from "../transcript.ts";
import { toTokenUsage } from "../usage.ts";
import { planIncrement, type Results } from "./increment.ts";
import { ANON_PREFIX, type SessionRegistry } from "./registry.ts";
import { CursorSession } from "./session.ts";
import { addedToolsNote, syncTools, toolsKeyOf } from "./tools.ts";
import { takeUsage } from "./usage-ledger.ts";
import type { StallInfo } from "./watchdog.ts";

/** How long parallel tool calls of one turn are collected before the host receives them. */
const HANDOFF_DEBOUNCE_MS = 50;
/** Extra time, inside the handoff budget, to catch the provider's report for that turn. */
const HANDOFF_USAGE_GRACE_MS = 40;
/** The whole pre-handoff window stays under this, so a tool call is never held back for long. */
const HANDOFF_BUDGET_MS = HANDOFF_DEBOUNCE_MS + HANDOFF_USAGE_GRACE_MS;
const CANCEL_WAIT_MS = 15_000;

export interface TurnModel {
  id: string;
  cursorParameters?: unknown;
}

export interface TurnServices {
  createAgent: (opts: any) => Promise<any>;
  registry: SessionRegistry;
  tiers: ContextTierStore;
  policy: ModelPolicy;
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

/** Report the open call's usage when the provider sent one; never invent one. */
async function attachUsage(reply: Reply, session: CursorSession, waitMs: number): Promise<void> {
  const usage = await takeUsage(session.ledger, waitMs, (ms) => session.waitForChange(ms));
  session.ledger.end();
  if (usage) reply.usage = toTokenUsage(usage);
}

async function openSession(
  key: string,
  modelId: string,
  params: Param[] | undefined,
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
  });
  s.systemPrompt = t.systemPrompt;
  const { local } = syncTools(s, t.tools);
  s.agent = await services.createAgent({
    model: {
      id: modelId,
      ...(params?.length ? { params } : {}),
      // Only an explicit policy turns on the provider's extended-context mode.
      ...(services.policy.maxMode === "on" ? { maxMode: true } : {}),
    },
    apiKey,
    // Always "mcp": host tools are MCP custom tools, and tools can be added later.
    tools: ["mcp"],
    local: { cwd, settingSources: [], customTools: local?.customTools },
  });
  services.registry.store(s);
  return s;
}

/**
 * Cursor fixes a run's tools when it starts. Cancel the waiting run and deliver its tool
 * results in a follow-up send that carries the new tools. False if the run would not stop.
 */
async function continueWithNewTools(
  s: CursorSession,
  results: Results,
  tools: any[],
  note: string,
  send: (s: CursorSession, text: string, images: any[] | undefined, options: any) => Promise<any>,
): Promise<boolean> {
  settle(() => void Promise.resolve(s.run?.cancel?.()).catch(() => {}));
  const deadline = Date.now() + CANCEL_WAIT_MS;
  while (!s.runDone && Date.now() < deadline) await s.waitForChange(deadline - Date.now());
  if (!s.runDone) return false;
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
  s.ledger.begin();
  s.startRun(await send(s, parts.join("\n\n"), imagesOf(results.map((r) => r.message)), syncTools(s, tools)));
  return true;
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
  const { registry, tiers, policy } = services;
  const modelId = resolveModelId(model.id);
  if (!apiKey) {
    return reply.finish("error", "No Cursor API key. Store CURSOR_API_KEY in DSH credentials or export it before launching DSH.", ERROR_CODES.missingKey);
  }

  const accepted = tiers.get(modelId);
  const params = modelParams(model, options.reasoning, policy, accepted);
  const signature = signatureOf(modelId, params);

  const send = async (s: CursorSession, text: string, images: any[] | undefined, sendOptions: any) =>
    s.agent.send(images?.length ? { text, images } : text, sendOptions);
  const sendFirst = async (s: CursorSession) => {
    s.sentFirst = true;
    s.ledger.begin();
    s.startRun(await send(s, renderTranscript(t.systemPrompt, t.messages), currentTurnImages(t.messages), {}));
  };

  let s = registry.find(sessionKey, signature);
  let plan = planIncrement(s, t.messages);
  let note = "";
  if (s && plan.kind !== "fresh") {
    const addition = systemPromptAddition(s.systemPrompt, t.systemPrompt);
    if (addition === undefined) plan = { kind: "fresh" };
    else note = addition;
  }
  debug(`turn key=${sessionKey.slice(0, 12)} msgs=${t.messages.length} seen=${s?.seen.length ?? "-"} plan=${plan.kind}`);
  if (s && plan.kind === "fresh") {
    registry.drop(s);
    s = undefined;
  }

  let freshRun = false;
  let emitted = false;
  const onAbort = () => s?.wake();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    if (!s || plan.kind === "fresh") {
      const started = Date.now();
      s = await openSession(sessionKey, modelId, params, t, apiKey, cwd, services);
      const created = Date.now();
      s.busy = true;
      await sendFirst(s);
      debug(`fresh key=${sessionKey.slice(0, 12)} create=${created - started}ms send=${Date.now() - created}ms chars=${renderTranscript(t.systemPrompt, t.messages).length} tools=${t.tools.length}`);
      freshRun = true;
    } else if (plan.kind === "send") {
      s.busy = true;
      const text = [note, addedToolsNote(s, t.tools), plan.text].filter(Boolean).join("\n\n");
      s.ledger.begin();
      s.startRun(await send(s, text, plan.images, syncTools(s, t.tools)));
      s.systemPrompt = t.systemPrompt;
    } else if (note || s.toolsKey !== toolsKeyOf(t.tools)) {
      s.busy = true;
      debug(`tools or system prompt changed mid-run key=${sessionKey.slice(0, 12)}`);
      if (await continueWithNewTools(s, plan.results, t.tools, note, send)) {
        s.systemPrompt = t.systemPrompt;
      } else {
        registry.drop(s);
        s = await openSession(sessionKey, modelId, params, t, apiKey, cwd, services);
        s.busy = true;
        await sendFirst(s);
        freshRun = true;
      }
    } else {
      s.busy = true;
      s.ledger.begin();
      for (const r of plan.results) {
        s.pending = s.pending.filter((p) => p !== r.call);
        r.call.resolve(toolResultForCursor(r.message, r.extra));
      }
    }
    s.touch();
    // A stall belongs to the run that stopped producing, never to the call that follows it.
    s.stall = undefined;
    s.watchdog.resume();
    // What Cursor has now seen; this call's reply is appended when it ends.
    s.seen = t.messages.map(fingerprint);

    for (;;) {
      while (s.eventCursor < s.events.length) {
        const msg = s.events[s.eventCursor++];
        if (msg?.type === "thinking") {
          reply.thinking(msg.text);
          emitted ||= Boolean(msg.text);
        } else if (msg?.type === "assistant") {
          for (const b of msg.message?.content ?? []) {
            if (b?.type === "text" && b.text) {
              reply.text(b.text);
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
        return reply.finish("aborted");
      }
      if (s.stall) {
        const info = s.stall;
        registry.drop(s);
        return reply.finish("error", stallMessage(modelId, info), ERROR_CODES.stalled);
      }

      const fresh = s.pending.filter((p) => !p.handed);
      if (fresh.length) {
        // The handoff window is the plugin's own delay, not provider silence: stop the monitor
        // before waiting, so a healthy tool turn can never be reported as a stall.
        s.watchdog.suspend();
        // Parallel calls arrive a few ms apart; hand them to the host together.
        const wait = s.lastCallAt + HANDOFF_DEBOUNCE_MS - Date.now();
        if (wait > 0) {
          await s.waitForChange(wait);
          continue;
        }
        for (const p of fresh) p.handed = true;
        reply.toolCalls(fresh.map((p) => ({ id: p.id, name: p.name, arguments: p.args })));
        // Inside the budget above, give the provider's report for this turn a chance to land.
        await attachUsage(reply, s, HANDOFF_USAGE_GRACE_MS);
        reply.finish("toolUse");
        s.seen.push(fingerprint(reply.message));
        return;
      }

      if (!s.runDone) {
        await s.waitForChange();
        continue;
      }

      const result = s.runResult;
      const status = result?.status ?? (s.runError ? "error" : "finished");
      if (status === "finished") {
        await attachUsage(reply, s, 0);
        s.run = undefined;
        reply.finish("stop");
        s.seen.push(fingerprint(reply.message));
        if (sessionKey.startsWith(ANON_PREFIX)) registry.drop(s);
        return;
      }

      const error = result?.error?.message ?? (s.runError instanceof Error ? s.runError.message : s.runError ? String(s.runError) : undefined);
      const lower = freshRun && !emitted && isRejectedParams(error) ? smallerContext(model, s.params) : undefined;
      if (lower) {
        const next = lower.find((p) => p.id === "context");
        if (next) tiers.set(modelId, next.value);
        registry.drop(s);
        s = await openSession(sessionKey, modelId, lower, t, apiKey, cwd, services);
        s.busy = true;
        await sendFirst(s);
        s.seen = t.messages.map(fingerprint);
        continue;
      }
      registry.drop(s);
      return reply.finish(status === "cancelled" ? "aborted" : "error", error);
    }
  } catch (err) {
    if (s) registry.drop(s);
    reply.finish(signal?.aborted ? "aborted" : "error", err instanceof Error ? err.message : String(err));
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
    if (s) {
      s.busy = false;
      if (!s.closed) s.touch();
    }
    reply.finish("error", "Cursor turn ended without a result");
  }
}
