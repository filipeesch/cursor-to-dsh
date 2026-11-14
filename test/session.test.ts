import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { CursorAdapter } from "../src/adapter.ts";
import { ModelCatalog } from "../src/cursor/catalog.ts";
import { ContextTierStore } from "../src/cursor/context-tier.ts";
import { DEFAULT_POLICY, type ModelPolicy } from "../src/policy/types.ts";
import { FALLBACK_MODELS } from "../src/model-catalog.ts";
import { SessionRegistry } from "../src/session/registry.ts";

/** Scripted fake Cursor agent. Each send runs `script(ctx)` as the model. */
function fakeCursor(script: (ctx: any) => AsyncGenerator<any, any, void> | Promise<any>) {
  const created: any[] = [];
  const sends: any[] = [];
  const sendOpts: any[] = [];
  const runs: any[] = [];
  const createAgent = async (opts: any) => {
    created.push(opts);
    const agentTools = opts.local?.customTools ?? {};
    return {
      send: async (msg: any, options?: any) => {
        sends.push(msg);
        sendOpts.push(options);
        const tools = options?.local?.customTools ?? agentTools;
        let status: any = { status: "finished" };
        const queue: any[] = [];
        let wake: (() => void) | undefined;
        let finished = false;
        let cancelled = false;
        const emit = (ev: any) => {
          if (cancelled || finished) return;
          queue.push(ev);
          wake?.();
        };
        const ctx = {
          msg,
          opts,
          emit,
          say: (text: string) => emit({ type: "assistant", message: { content: [{ type: "text", text }] } }),
          think: (text: string) => emit({ type: "thinking", text }),
          usage: (usage: any) => emit({ type: "usage", usage }),
          callTool: async (name: string, args: any, id: string) => {
            if (!tools[name]) throw new Error(`unknown tool ${name}`);
            return tools[name].execute(args, { toolCallId: id });
          },
          setStatus: (s: any) => (status = s),
        };
        runs.push({ emit: (ev: any) => emit(ev) });
        (async () => {
          try {
            for await (const ev of await script(ctx)) emit(ev);
          } catch {
            /* a failing script still ends its turn */
          }
          finished = true;
          wake?.();
        })();
        return {
          stream: async function* () {
            for (;;) {
              while (queue.length) yield queue.shift();
              if (finished) return;
              await new Promise<void>((r) => (wake = r));
            }
          },
          wait: async () => {
            while (!finished) await new Promise((r) => setTimeout(r, 1));
            return status;
          },
          cancel: async () => {
            if (finished) return;
            cancelled = true;
            status = { status: "cancelled" };
            finished = true;
            wake?.();
          },
        };
      },
      close: () => {},
    };
  };
  return {
    createAgent,
    created,
    sends,
    sendOpts,
    runs,
    emit: (ev: any) => runs.at(-1)?.emit(ev),
  };
}

let seq = 0;
const nextId = () => `msg-${++seq}`;
const text = (t: string) => [{ type: "text", text: t }];
const sys = (t: string) => ({ id: nextId(), role: "system", content: text(t), source: { kind: "system-prompt" } });
const user = (t: string) => ({ id: nextId(), role: "user", content: text(t), source: { kind: "user" } });
const dev = (t: string) => ({ id: nextId(), role: "developer", content: text(t), source: { kind: "user" } });
const toolResult = (callId: string, t: string, isError = false) => ({
  id: nextId(),
  role: "tool",
  toolCallId: callId,
  isError,
  content: text(t),
  source: { kind: "tool", callId },
});

const readTool = { name: "read", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } } } };
const xTool = { name: "x_doctor", description: "Check X", parameters: { type: "object", properties: {} } };

const v = (...values: string[]) => values.map((value) => ({ value }));
const catalogModels = [
  { id: "m", displayName: "M" },
  {
    id: "claude",
    displayName: "Claude",
    parameters: [
      { id: "thinking", values: v("true", "false") },
      { id: "effort", values: v("low", "high") },
      { id: "fast", values: v("true", "false") },
      { id: "context", values: v("300k", "1m") },
    ],
  },
];

let env: any;
const tick = async (times = 6) => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
};

function adapterFor(cursor: { createAgent: any }, deps: any = {}) {
  const catalog = deps.catalog ?? new ModelCatalog({ listModels: async () => catalogModels, resolveApiKey: async () => "k" });
  if (!deps.catalog) catalog.load({ models: catalogModels, live: true, fetchedAt: Date.now() });
  env = {
    catalog,
    tiers: deps.tiers ?? new ContextTierStore(),
    registry: deps.registry ?? new SessionRegistry(),
    policy: (deps.policy ?? DEFAULT_POLICY) as ModelPolicy,
    publishedWindow: deps.publishedWindow,
    stallTimeoutMs: deps.stallTimeoutMs ?? 0,
    onStall: deps.onStall,
  };
  return new CursorAdapter({
    createAgent: cursor.createAgent,
    resolveApiKey: deps.resolveApiKey ?? (async () => "k"),
    cwdFor: deps.cwdFor ?? (() => "/work"),
    ...(deps.readImage ? { readImage: deps.readImage } : {}),
    catalog: env.catalog,
    tiers: env.tiers,
    registry: env.registry,
    readPolicy: () => env.policy,
    publishedWindow: (modelId: string) => env.publishedWindow?.(modelId),
    stallTimeoutMs: env.stallTimeoutMs,
    onStall: env.onStall,
  });
}

/** One host model call; the reply is assembled the way the host stores it. */
async function call(adapter: CursorAdapter, messages: any[], options: any = {}) {
  const chunks: any[] = [];
  for await (const c of adapter.stream({ provider: "cursor", model: "m", messages, tools: [readTool], sessionId: "sess-1", ...options })) chunks.push(c);
  const blocks = chunks.filter((c) => c.type === "block-end").map((c) => c.block);
  const assistant = { id: nextId(), role: "assistant", content: blocks, source: { kind: "model", provider: "cursor", model: options.model ?? "m" } };
  return {
    chunks,
    finish: chunks.at(-1).reason,
    assistant,
    usage: chunks.find((c) => c.type === "usage")?.usage,
    text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
    calls: blocks.filter((b) => b.type === "tool-call"),
  };
}

beforeEach(() => {
  env = undefined;
});

test("one Cursor agent per session; later calls send only the new user text", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("echo");
  });
  const adapter = adapterFor(cursor);
  const s = sys("SYS");
  const u1 = user("hello");
  const r1 = await call(adapter, [s, u1]);
  assert.deepEqual(r1.finish, { kind: "stop" });
  assert.equal(r1.text, "echo");
  assert.match(cursor.sends[0], /^Only the tools attached[\s\S]*SYS[\s\S]*### user\nhello$/);
  assert.equal(cursor.created[0].local.cwd, "/work");
  assert.deepEqual(cursor.created[0].tools, ["mcp"]);
  assert.deepEqual(cursor.created[0].local.settingSources, []);

  const r2 = await call(adapter, [s, u1, r1.assistant, user("again")]);
  assert.deepEqual(r2.finish, { kind: "stop" });
  assert.equal(cursor.created.length, 1, "agent reused");
  assert.equal(cursor.sends[1], "again", "only the new text is sent");
});

test("usage: a call that is its own run reports its usage exactly", async () => {
  let turn = 0;
  const cursor = fakeCursor(async function* (ctx: any) {
    turn++;
    ctx.say(`turn ${turn}`);
    ctx.usage({ inputTokens: 100 * turn, outputTokens: turn, cacheReadTokens: 10 * turn, cacheWriteTokens: 2 * turn });
  });
  const adapter = adapterFor(cursor);
  const messages: any[] = [user("go")];
  const usages: any[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await call(adapter, messages);
    assert.equal(r.chunks.filter((c: any) => c.type === "usage").length, 1, "exactly one usage chunk per call");
    usages.push(r.usage);
    messages.push(r.assistant, user(`again ${i}`));
  }
  assert.deepEqual(usages, [
    { inputTokens: 100, outputTokens: 1, cacheReadTokens: 10, cacheWriteTokens: 2 },
    { inputTokens: 200, outputTokens: 2, cacheReadTokens: 20, cacheWriteTokens: 4 },
    { inputTokens: 300, outputTokens: 3, cacheReadTokens: 30, cacheWriteTokens: 6 },
  ]);
  assert.ok(usages.every((u) => (u as any).totalTokens === undefined), "no combined total is emitted");
});

test("usage: a tool-call call reports its turn; a call with no report reports nothing", async () => {
  let got: any;
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("reading");
    ctx.usage({ inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0 });
    got = await ctx.callTool("read", { path: "a.txt" }, "call-1");
    ctx.say("done");
  });
  const adapter = adapterFor(cursor);
  const s = sys("SYS");
  const u1 = user("read a.txt");
  const r1 = await call(adapter, [s, u1]);
  assert.deepEqual(r1.finish, { kind: "tool-calls" });
  assert.deepEqual(r1.usage, { inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0 });

  const r2 = await call(adapter, [s, u1, r1.assistant, toolResult("call-1", "FILE")]);
  assert.deepEqual(r2.finish, { kind: "stop" });
  assert.deepEqual(got, { content: [{ type: "text", text: "FILE" }], isError: false });
  assert.equal(r2.usage, undefined, "the second turn reported nothing, so nothing is invented");
  assert.equal(cursor.sends.length, 1, "no second send: the run continued");
});

test("usage: a report that arrives while no call is open is dropped, not carried forward", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    await ctx.callTool("read", { path: "a" }, "c-1");
    ctx.say("done");
  });
  const adapter = adapterFor(cursor);
  const u1 = user("go");
  const r1 = await call(adapter, [u1]);
  assert.equal(r1.usage, undefined);

  cursor.emit({ type: "usage", usage: { inputTokens: 999, outputTokens: 99, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  await tick();

  const r2 = await call(adapter, [u1, r1.assistant, toolResult("c-1", "FILE")]);
  assert.equal(r2.text, "done");
  assert.equal(r2.usage, undefined, "the late report belongs to the closed call");
});

test("usage: a multi-call run reports once, normalized to one request", { timeout: 10_000 }, async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("step 1");
    await ctx.callTool("read", { path: "a" }, "c-1");
    ctx.say("step 2");
    await ctx.callTool("read", { path: "b" }, "c-2");
    ctx.say("answer");
    // One report per run, covering all three model calls.
    ctx.usage({ inputTokens: 30_000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
  const adapter = adapterFor(cursor);
  const messages: any[] = [user("go")];
  const usages: any[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await call(adapter, messages);
    usages.push(r.usage);
    messages.push(r.assistant);
    if (i <= 2) messages.push(toolResult(`c-${i}`, `R${i}`));
  }
  assert.deepEqual(usages, [
    undefined,
    undefined,
    { inputTokens: 10_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ]);
});

test("usage: the previous turn's report is not attributed to the next call", { timeout: 10_000 }, async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("one");
    await ctx.callTool("read", { path: "a" }, "c-1");
    // Turn 2 opens when the host delivers the tool result: a stale report arrives first.
    ctx.usage({ inputTokens: 999, outputTokens: 99, cacheReadTokens: 0, cacheWriteTokens: 0 });
    ctx.say("two");
    // This run served two calls by now, so the report is normalized to one request.
    ctx.usage({ inputTokens: 20, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
  const adapter = adapterFor(cursor);
  const u1 = user("go");
  const r1 = await call(adapter, [u1]);
  assert.equal(r1.usage, undefined, "turn 1 reported nothing");
  const r2 = await call(adapter, [u1, r1.assistant, toolResult("c-1", "FILE")]);
  assert.equal(r2.text, "two");
  assert.deepEqual(r2.usage, { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, "the stale report is discarded and the real one is normalized");
});

test("a long tool wait is not mistaken for a stall", { timeout: 10_000 }, async () => {
  const stalls: any[] = [];
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("working");
    await ctx.callTool("read", { path: "a" }, "c-1");
    ctx.say("done");
  });
  const adapter = adapterFor(cursor, { stallTimeoutMs: 30, onStall: (_s: any, info: any) => stalls.push(info) });
  const u1 = user("go");
  const r1 = await call(adapter, [u1]);
  assert.deepEqual(r1.finish, { kind: "tool-calls" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const r2 = await call(adapter, [u1, r1.assistant, toolResult("c-1", "FILE")]);
  assert.equal(r2.text, "done");
  assert.equal(stalls.length, 0, "the host holding the tool is not provider silence");
});

test("a stall records a diagnostic with the model and elapsed time", { timeout: 5_000 }, async () => {
  const stalls: any[] = [];
  const cursor = fakeCursor(async function* () {
    await new Promise(() => {});
  });
  const adapter = adapterFor(cursor, {
    stallTimeoutMs: 25,
    onStall: (session: any, info: any) => stalls.push({ key: session.key, model: session.modelId, ...info }),
  });
  const r = await call(adapter, [user("hi")]);
  assert.equal(r.finish.failure.code, "CURSOR_RUN_STALLED");
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].key, "sess-1");
  assert.equal(stalls[0].model, "m");
  assert.ok(stalls[0].elapsedMs >= 20);
});

test("the tool handoff stays inside its budget even with no usage report", { timeout: 5_000 }, async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("working");
    await ctx.callTool("read", { path: "a" }, "c-1");
  });
  const adapter = adapterFor(cursor);
  const started = Date.now();
  const r = await call(adapter, [user("go")]);
  const elapsed = Date.now() - started;
  assert.deepEqual(r.finish, { kind: "tool-calls" });
  assert.equal(r.usage, undefined);
  assert.ok(elapsed < 220, `handoff took ${elapsed}ms, above the handoff budget`);
});

test("a tool call stays inside one Cursor run and gets the host's real result", async () => {
  let got: any;
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("reading");
    got = await ctx.callTool("read", { path: "a.txt" }, "call-1");
    ctx.say("done");
  });
  const adapter = adapterFor(cursor);
  const s = sys("SYS");
  const u1 = user("read a.txt");
  const r1 = await call(adapter, [s, u1]);
  assert.deepEqual(r1.finish, { kind: "tool-calls" });
  assert.equal(r1.text, "reading");
  assert.deepEqual(r1.calls, [{ type: "tool-call", id: "call-1", name: "read", arguments: '{"path":"a.txt"}' }]);

  const r2 = await call(adapter, [s, u1, r1.assistant, toolResult("call-1", "FILE")]);
  assert.deepEqual(r2.finish, { kind: "stop" });
  assert.equal(r2.text, "done");
  assert.deepEqual(got, { content: [{ type: "text", text: "FILE" }], isError: false });
  assert.equal(cursor.created.length, 1);
  assert.equal(cursor.sends.length, 1, "no second send: the run continued");
});

test("parallel tool calls are handed to the host together", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    const [a, b] = await Promise.all([ctx.callTool("read", { path: "a" }, "c-a"), ctx.callTool("read", { path: "b" }, "c-b")]);
    ctx.say(`${a.content[0].text}+${b.content[0].text}`);
  });
  const adapter = adapterFor(cursor);
  const u1 = user("read both");
  const r1 = await call(adapter, [u1]);
  assert.deepEqual(r1.calls.map((c: any) => c.id), ["c-a", "c-b"]);
  const r2 = await call(adapter, [u1, r1.assistant, toolResult("c-a", "A"), toolResult("c-b", "B", true)]);
  assert.equal(r2.text, "A+B");
});

test("context messages the host adds are sent with the next user text", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  const adapter = adapterFor(cursor);
  const u1 = user("x");
  const r1 = await call(adapter, [u1]);
  await call(adapter, [u1, r1.assistant, dev("cwd is /work"), user("y")]);
  assert.equal(cursor.created.length, 1);
  assert.equal(cursor.sends[1], "[context]\ncwd is /work\n\ny");
});

test("a user message sent while a tool runs rides along with the tool result", async () => {
  const results: any[] = [];
  const cursor = fakeCursor(async function* (ctx: any) {
    results.push(await ctx.callTool("read", { path: "a" }, "c-1"));
    ctx.say("done");
  });
  const adapter = adapterFor(cursor);
  const u1 = user("go");
  const r1 = await call(adapter, [u1]);
  await call(adapter, [u1, r1.assistant, toolResult("c-1", "FILE"), user("also check b")]);
  assert.match(results[0].content.at(-1).text, /while the tool was running\]\nalso check b$/);
});

test("removed tools are dropped silently; only added ones are announced", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  const adapter = adapterFor(cursor);
  const u1 = user("x");
  const r1 = await call(adapter, [u1], { tools: [readTool, xTool] });
  await call(adapter, [u1, r1.assistant, user("y")], { tools: [readTool] });
  assert.equal(cursor.sends[1], "y");
  assert.deepEqual(Object.keys(cursor.sendOpts[1].local.customTools), ["read"]);
});

test("a rewritten history (compaction) replays from scratch on a new agent", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  const adapter = adapterFor(cursor);
  await call(adapter, [user("first")]);
  await call(adapter, [user("[summary] first -> ok"), user("next")]);
  assert.equal(cursor.created.length, 2);
  assert.match(cursor.sends[1], /\[summary\]/);
  assert.equal(env.registry.count(), 1);
});

test("system prompt: a later system message with added lines keeps the agent, a rewrite does not", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  const adapter = adapterFor(cursor);
  const s = sys("SYS");
  const u1 = user("x");
  const r1 = await call(adapter, [s, u1]);
  const u2 = user("y");
  const r2 = await call(adapter, [s, u1, r1.assistant, sys("SYS\n- x_doctor: diagnose"), u2], { tools: [readTool, xTool] });
  assert.equal(cursor.created.length, 1, "agent reused");
  assert.match(cursor.sends[1], /system prompt update[^\n]*\n- x_doctor: diagnose\n\n\[Tool update: [^\n]*available: x_doctor\.[^\n]*\]\n\ny$/);
  assert.deepEqual(Object.keys(cursor.sendOpts[1].local.customTools), ["read", "x_doctor"]);

  await call(adapter, [s, u1, r1.assistant, sys("SYS\n- x_doctor: diagnose"), u2, r2.assistant, sys("OTHER"), user("z")]);
  assert.equal(cursor.created.length, 2, "rewritten prompt starts over");
});

test("a tool change while the host runs a tool continues on the same agent with the new tools", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    if (typeof ctx.msg === "string" && ctx.msg.startsWith("[Tool results")) {
      await ctx.callTool("x_doctor", {}, "c-x");
      ctx.say("done");
      return;
    }
    await ctx.callTool("read", { path: "a" }, "c-1");
    ctx.say("stale run");
  });
  const adapter = adapterFor(cursor);
  const u1 = user("go");
  const r1 = await call(adapter, [u1]);
  const res1 = toolResult("c-1", "FILE");
  const r2 = await call(adapter, [u1, r1.assistant, res1], { tools: [readTool, xTool] });
  assert.equal(r2.calls[0]?.name, "x_doctor");
  assert.equal(cursor.created.length, 1);
  assert.match(cursor.sends[1], /### read \(c-1\)\nFILE[\s\S]*available: x_doctor\./);
  const r3 = await call(adapter, [u1, r1.assistant, res1, r2.assistant, toolResult("c-x", "OK")], { tools: [readTool, xTool] });
  assert.equal(r3.text, "done");
  assert.equal(cursor.sends.length, 2, "the follow-up run continued");
});

test("an aborted call finishes as aborted and drops the session", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    await new Promise((r) => setTimeout(r, 50));
    ctx.say("late");
  });
  const adapter = adapterFor(cursor);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);
  const r = await call(adapter, [user("hi")], { signal: controller.signal });
  assert.equal(r.finish.kind, "aborted");
  assert.equal(r.finish.failure.code, "ABORTED");
  assert.equal(env.registry.count(), 0);
});

test("a failed run reports a non-retryable error code", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.setStatus({ status: "error", error: { message: "model exploded" } });
  });
  const r = await call(adapterFor(cursor), [user("hi")]);
  assert.deepEqual(r.finish, { kind: "error", failure: { message: "model exploded", code: "CURSOR_RUN_FAILED" } });
  assert.equal(env.registry.count(), 0);
});

test("a silent run is abandoned with its own non-retryable code", { timeout: 5_000 }, async () => {
  const cursor = fakeCursor(async function* () {
    await new Promise(() => {});
  });
  const adapter = adapterFor(cursor, { stallTimeoutMs: 30 });
  const r = await call(adapter, [user("hi")]);
  assert.equal(r.finish.kind, "error");
  assert.equal(r.finish.failure.code, "CURSOR_RUN_STALLED");
  assert.match(r.finish.failure.message, /produced no content/);
  assert.equal(env.registry.count(), 0);
});

test("the catalog never blocks a call, even when it is stale", { timeout: 5_000 }, async () => {
  let catalogCalls = 0;
  const catalog = new ModelCatalog({
    listModels: () => {
      catalogCalls++;
      return new Promise<any[]>(() => {});
    },
    resolveApiKey: async () => "k",
    freshMs: 1,
  });
  catalog.load({ models: catalogModels, live: true, fetchedAt: 0 });
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  const r = await call(adapterFor(cursor, { catalog }), [user("hi")]);
  assert.equal(r.finish.kind, "stop");
  assert.equal(catalogCalls, 1, "the refresh started in the background and was not awaited");
});

test("catalog params: effort mapped, Fast off, context stepped down and remembered", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  const created: any[] = [];
  const createAgent = async (opts: any) => {
    created.push(opts.model.params);
    const agent = await cursor.createAgent(opts);
    if (!opts.model.params?.some((p: any) => p.value === "1m")) return agent;
    return {
      ...agent,
      send: async () => ({
        stream: async function* () {},
        wait: async () => ({ status: "error", error: { message: 'Invalid parameters for registry model: "claude"' } }),
        cancel: async () => {},
      }),
    };
  };
  const r = await call(adapterFor({ createAgent }), [user("hi")], { model: "claude", reasoningEffort: "low" });
  assert.deepEqual(r.finish, { kind: "stop" });
  assert.deepEqual(created[0], [
    { id: "thinking", value: "true" },
    { id: "effort", value: "low" },
    { id: "fast", value: "false" },
    { id: "context", value: "1m" },
  ]);
  assert.equal(created[1].at(-1).value, "300k");
  assert.equal(env.tiers.get("claude"), "300k", "the accepted tier is remembered for the next run");
});

test("models: the advertised window is the accepted tier, with an explicit override", async () => {
  const adapter = adapterFor(fakeCursor(async function* () {}));
  assert.deepEqual((await adapter.listModels("cursor")).map((m: any) => m.id), ["m", "claude"]);
  const claude = await adapter.resolveModel("cursor", "claude");
  assert.equal(claude.name, "Claude");
  assert.equal(claude.context.contextWindow, 1_000_000);
  assert.equal(claude.systemPromptUpdate, "in-history");
  assert.deepEqual(claude.reasoning.efforts.map((e: any) => e.id), ["off", "low", "high"]);
  assert.equal((await adapter.resolveModel("cursor", "m")).reasoning, undefined);
  assert.equal((await adapter.resolveModel("cursor", "unlisted")).name, "unlisted");

  const stepped = adapterFor(fakeCursor(async function* () {}), { tiers: new ContextTierStore({ claude: "300k" }) });
  assert.equal((await stepped.resolveModel("cursor", "claude")).context.contextWindow, 300_000);

  const manual = adapterFor(fakeCursor(async function* () {}), { policy: { ...DEFAULT_POLICY, models: { "*": { contextWindow: 400_000 } } } });
  assert.equal((await manual.resolveModel("cursor", "claude")).context.contextWindow, 1_000_000, "a manual value never beats the provider tier");
  assert.equal((await manual.resolveModel("cursor", "m")).context.contextWindow, 400_000, "a model nothing describes takes the manual value");

  const duplicated = [...catalogModels, { id: "auto-smart", displayName: "Auto" }, { id: "default", displayName: "Auto" }];
  const autosCatalog = new ModelCatalog({ listModels: async () => duplicated, resolveApiKey: async () => "k" });
  autosCatalog.load({ models: duplicated, live: true, fetchedAt: Date.now() });
  const autos = adapterFor(fakeCursor(async function* () {}), { catalog: autosCatalog });
  assert.deepEqual((await autos.listModels("cursor")).map((m: any) => m.name), ["M", "Claude", "Auto (auto-smart)", "Auto (default)"]);

  const offline = adapterFor(fakeCursor(async function* () {}), {
    catalog: new ModelCatalog({ listModels: async () => { throw new Error("offline"); }, resolveApiKey: async () => "k" }),
  });
  assert.deepEqual((await offline.listModels("cursor")).map((m: any) => m.id), FALLBACK_MODELS.map((m) => m.id));
});

test("Max Mode reaches agent creation only when the policy asks for it", async () => {
  const offCursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  await call(adapterFor(offCursor, { policy: { ...DEFAULT_POLICY, maxMode: "off" } }), [user("hi")]);
  assert.equal(offCursor.created[0].model.maxMode, undefined, "off never sends the flag");

  const autoCursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  await call(adapterFor(autoCursor, { policy: { ...DEFAULT_POLICY, maxMode: "auto" } }), [user("hi")]);
  assert.equal(autoCursor.created[0].model.maxMode, undefined, "auto leaves the decision to the provider");

  const onCursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  await call(adapterFor(onCursor, { policy: { ...DEFAULT_POLICY, maxMode: "on" } }), [user("hi")]);
  assert.equal(onCursor.created[0].model.maxMode, true, "on sends the flag");
});

test("models: the published capacity fills a model the tier does not describe", async () => {
  const adapter = adapterFor(fakeCursor(async function* () {}), {
    publishedWindow: (modelId: string) => (modelId === "m" ? 1_048_576 : undefined),
  });
  assert.equal((await adapter.resolveModel("cursor", "m")).context.contextWindow, 1_048_576);
  assert.equal((await adapter.resolveModel("cursor", "claude")).context.contextWindow, 1_000_000, "the provider tier still wins");

  const manual = adapterFor(fakeCursor(async function* () {}), {
    publishedWindow: (modelId: string) => (modelId === "m" ? 1_048_576 : undefined),
    policy: { ...DEFAULT_POLICY, models: { m: { contextWindow: 500_000 } } },
  });
  assert.equal((await manual.resolveModel("cursor", "m")).context.contextWindow, 1_048_576, "a published capacity beats a manual value");
});

test("models: a disabled model leaves the advertised catalog but still resolves", async () => {
  const adapter = adapterFor(fakeCursor(async function* () {}), {
    policy: { ...DEFAULT_POLICY, models: { claude: { enabled: false } } },
  });
  assert.deepEqual((await adapter.listModels("cursor")).map((m: any) => m.id), ["m"]);
  assert.equal((await adapter.resolveModel("cursor", "claude")).name, "Claude", "a saved selection keeps resolving");

  const disabledByDefault = adapterFor(fakeCursor(async function* () {}), {
    policy: { ...DEFAULT_POLICY, newModels: "disabled", models: { m: { enabled: true } } },
  });
  assert.deepEqual((await disabledByDefault.listModels("cursor")).map((m: any) => m.id), ["m"]);
});

test("models: the policy is read per call, so a saved setting applies without a remount", async () => {
  const adapter = adapterFor(fakeCursor(async function* () {}));
  assert.equal((await adapter.resolveModel("cursor", "m")).context.contextWindow, 200_000);
  env.policy = { ...DEFAULT_POLICY, models: { m: { contextWindow: 262_144 }, claude: { enabled: false } } };
  assert.equal((await adapter.resolveModel("cursor", "m")).context.contextWindow, 262_144);
  assert.deepEqual((await adapter.listModels("cursor")).map((model: any) => model.id), ["m"]);
});

test("models: a per-model Max Mode policy reaches agent creation", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("ok");
  });
  await call(adapterFor(cursor, {
    catalog: (() => {
      const models = [{ id: "m", parameters: [{ id: "context", values: [{ value: "300k" }, { value: "1m" }] }], variants: [
        { params: [{ id: "context", value: "300k" }] },
        { params: [{ id: "context", value: "1m" }], isMaxMode: true },
      ] }];
      const catalog = new ModelCatalog({ listModels: async () => models, resolveApiKey: async () => "k" });
      catalog.load({ models, live: true, fetchedAt: Date.now() });
      return catalog;
    })(),
    policy: { ...DEFAULT_POLICY, models: { m: { maxMode: "on" } } },
  }), [user("hi")]);
  assert.equal(cursor.created[0].model.maxMode, true);
  assert.deepEqual(cursor.created[0].model.params.filter((p: any) => p.id === "context"), [{ id: "context", value: "1m" }]);
});

test("auxiliary calls (session titles) get their own agent and leave the session alone", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say(typeof ctx.msg === "string" && ctx.msg.includes("Title this") ? "A title" : "ok");
  });
  const adapter = adapterFor(cursor);
  const u1 = user("x");
  const r1 = await call(adapter, [u1]);
  const title = await call(adapter, [user("Title this")], { purpose: "session-title", tools: [] });
  assert.equal(title.text, "A title");
  assert.equal(env.registry.count(), 1, "the title agent is closed");
  await call(adapter, [u1, r1.assistant, user("y")]);
  assert.equal(cursor.created.length, 2, "main session kept its agent");
  assert.equal(cursor.sends.at(-1), "y");
});

test("a missing API key fails with MISSING_CREDENTIAL and creates no agent", async () => {
  const cursor = fakeCursor(async function* () {});
  const r = await call(adapterFor(cursor, { resolveApiKey: async () => undefined }), [user("hi")]);
  assert.equal(r.finish.kind, "error");
  assert.equal(r.finish.failure.code, "MISSING_CREDENTIAL");
  assert.equal(cursor.created.length, 0);
});

test("stop sequences are rejected instead of silently dropped", async () => {
  const cursor = fakeCursor(async function* () {});
  await assert.rejects(call(adapterFor(cursor), [user("hi")], { stop: ["END"] }), (err: any) => err.failure?.code === "UNSUPPORTED_OPTION");
});

const imageBlock = (id: string) => ({ type: "image", attachment: { attachmentId: id, mediaType: "image/png", bytes: 3, width: 1, height: 1 } });

test("user images reach Cursor as bytes and each attachment is read once", async () => {
  const cursor = fakeCursor(async function* (ctx: any) {
    ctx.say("seen");
  });
  const reads: string[] = [];
  const adapter = adapterFor(cursor, {
    readImage: async (ref: any) => {
      reads.push(ref.attachmentId);
      return { data: `B64-${ref.attachmentId}`, mimeType: ref.mediaType };
    },
  });
  const u1 = { id: nextId(), role: "user", content: [{ type: "text", text: "what is this" }, imageBlock("a1")], source: { kind: "user" } };
  const r1 = await call(adapter, [u1]);
  assert.deepEqual(cursor.sends[0].images, [{ data: "B64-a1", mimeType: "image/png" }]);
  assert.match(cursor.sends[0].text, /### user\nwhat is this$/);

  const u2 = { id: nextId(), role: "user", content: [{ type: "text", text: "and this" }, imageBlock("a2")], source: { kind: "user" } };
  await call(adapter, [u1, r1.assistant, u2]);
  assert.deepEqual(cursor.sends[1], { text: "and this", images: [{ data: "B64-a2", mimeType: "image/png" }] });
  assert.deepEqual(reads, ["a1", "a2"], "a1 came from the cache on the second call");
  assert.deepEqual((await adapter.listModels("cursor"))[0].inputModalities, ["text", "image"]);
});

test("tool results carry images to Cursor; unreadable images become a note", async () => {
  let toolGot: any;
  const cursor = fakeCursor(async function* (ctx: any) {
    toolGot = await ctx.callTool("read", { path: "shot.png" }, "c-img");
    ctx.say("seen");
  });
  const adapter = adapterFor(cursor, {
    readImage: async (ref: any) => {
      if (ref.attachmentId === "broken") throw new Error("gone");
      return { data: `B64-${ref.attachmentId}`, mimeType: ref.mediaType };
    },
  });
  const u1 = user("look at the screenshot");
  const r1 = await call(adapter, [u1]);
  const shot = { id: nextId(), role: "tool", toolCallId: "c-img", content: [imageBlock("a2"), imageBlock("broken")], source: { kind: "tool", callId: "c-img" } };
  await call(adapter, [u1, r1.assistant, shot]);
  assert.deepEqual(toolGot.content, [
    { type: "image", data: "B64-a2", mimeType: "image/png" },
    { type: "text", text: "[image attachment not forwarded to Cursor]" },
  ]);
});
