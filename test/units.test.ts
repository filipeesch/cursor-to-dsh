import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_POLICY, advertisedContextWindow } from "../src/models.ts";
import { ChunkQueue, Reply } from "../src/reply.ts";
import { configureRipgrep, prewarmCursor, resetPrewarm } from "../src/sdk.ts";
import { readRequest } from "../src/transcript.ts";
import { currentTurnImages, textOf } from "../src/prompt/content.ts";
import { fingerprint } from "../src/prompt/fingerprint.ts";
import { renderTranscript, systemPromptAddition, toolResultForCursor } from "../src/prompt/render.ts";
import { sessionKeyFor, SessionRegistry } from "../src/session/registry.ts";
import { UsageLedger, takeUsage } from "../src/session/usage-ledger.ts";
import { StallWatchdog } from "../src/session/watchdog.ts";
import { ModelCatalog } from "../src/cursor/catalog.ts";
import { ContextTierStore } from "../src/cursor/context-tier.ts";
import { pluginStateDir, readJsonFile, resolveStateDir, writeJsonFile, type TierFile } from "../src/cursor/state.ts";
import { createStallDiagnostics } from "../src/diagnostics.ts";
import { resolveSettings } from "../src/config.ts";
import { buckets, toTokenUsage } from "../src/usage.ts";

const tick = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
};

test("the first send puts the system prompt and history in front of Cursor", () => {
  const text = renderTranscript("SYS", [
    { role: "user", content: "hi" },
    { role: "developer", content: [{ type: "text", text: "ctx" }] },
    { role: "assistant", content: [{ type: "text", text: "reading" }, { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } }] },
    { role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "A" }], isError: true },
  ]);
  assert.match(text, /^Only the tools attached to this request/);
  assert.match(text, /AGENTS\.md and similar[\s\S]*\n\nSYS\n\nConversation so far:\n\n### user\nhi\n\n### context\nctx/);
  assert.match(text, /### assistant\nreading\ncalls read \(c1\) with \{"path":"a"\}/);
  assert.match(text, /### read \(c1\) \[error\]\nA$/);
  assert.doesNotMatch(renderTranscript("", [{ role: "user", content: "x" }]), /AGENTS/);
});

test("fingerprints ignore what Cursor never saw", () => {
  const a = { role: "assistant", content: [{ type: "text", text: "ok" }] };
  assert.equal(fingerprint(a), fingerprint({ ...a, content: [{ type: "thinking", thinking: "hm" }, ...a.content] }));
  assert.notEqual(fingerprint({ role: "user", content: "a" }), fingerprint({ role: "user", content: "b" }));
  assert.notEqual(fingerprint({ role: "user", content: "a" }), fingerprint({ role: "developer", content: "a" }));
});

test("tool results keep images and extra text", () => {
  const img = { type: "image", data: "B64", mimeType: "image/png" };
  assert.deepEqual(currentTurnImages([{ role: "user", content: [{ type: "text", text: "see" }, img] }]), [{ data: "B64", mimeType: "image/png" }]);
  const old = { type: "image", data: "OLD", mimeType: "image/png" };
  assert.deepEqual(
    currentTurnImages([
      { role: "user", content: [old] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [img, { type: "text", text: "see" }] },
      { role: "user", content: [{ type: "text", text: "runtime context" }] },
      { role: "developer", content: [{ type: "text", text: "time" }] },
    ]),
    [{ data: "B64", mimeType: "image/png" }],
  );
  assert.deepEqual(toolResultForCursor({ content: [img], isError: false }, "note").content, [
    { type: "image", data: "B64", mimeType: "image/png" },
    { type: "text", text: "note" },
  ]);
  assert.deepEqual(toolResultForCursor({ content: [] }).content, [{ type: "text", text: "(no output)" }]);
  assert.equal(textOf([{ type: "text", text: "a" }, { type: "image", data: "x" }]), "a");
});

test("systemPromptAddition returns only added lines and refuses removals", () => {
  assert.equal(systemPromptAddition("a\nb", "a\nb"), "");
  assert.match(systemPromptAddition("a\nb", "a\nnew\nb")!, /\]\nnew$/);
  assert.equal(systemPromptAddition("a\nb", "a\nB"), undefined);
  assert.equal(systemPromptAddition("a\nb", "a"), undefined);
});

test("usage buckets are disjoint and exactly what the provider states", () => {
  assert.deepEqual(buckets({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 10 }), {
    input: 100,
    output: 10,
    cacheRead: 80,
    cacheWrite: 10,
  });
  assert.deepEqual(toTokenUsage({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 10 }), {
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 80,
    cacheWriteTokens: 10,
  });
  assert.deepEqual(buckets({}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
});

test("the usage ledger keeps one report per open call and drops the rest", async () => {
  const ledger = new UsageLedger();
  ledger.report({ inputTokens: 1 });
  assert.equal(ledger.ready, false, "a report before any call is ignored");

  ledger.begin();
  ledger.report({ inputTokens: 2 });
  assert.equal(ledger.ready, false, "a report before this turn produced content belongs to an earlier turn");
  ledger.sawContent();
  ledger.report({ inputTokens: 2 });
  assert.equal(ledger.ready, true);
  assert.equal((await takeUsage(ledger, 0, async () => {}))!.inputTokens, 2);
  ledger.end();
  assert.equal(ledger.ready, false, "taking the report leaves nothing behind");

  ledger.begin();
  assert.equal(await takeUsage(ledger, 0, async () => {}), undefined, "a call with no report waits zero and reports nothing");
  ledger.end();
  ledger.report({ inputTokens: 3 });
  assert.equal(ledger.ready, false, "a report after the call closed is discarded");
});

test("takeUsage waits for the open call's report only up to its bound", async () => {
  const ledger = new UsageLedger();
  ledger.begin();
  ledger.sawContent();
  const started = Date.now();
  const missing = await takeUsage(ledger, 30, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  assert.equal(missing, undefined);
  assert.ok(Date.now() - started >= 25, "it waited for the report");

  const quick = new UsageLedger();
  quick.begin();
  quick.sawContent();
  const arriving = takeUsage(quick, 500, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  setTimeout(() => quick.report({ outputTokens: 7 }), 5);
  assert.equal((await arriving)!.outputTokens, 7);
});

test("the watchdog fires on silence, ignores keep-alives and pauses during a tool wait", async () => {
  const stalls: any[] = [];
  const dog = new StallWatchdog({ timeoutMs: 20, onStall: (info) => stalls.push(info) });
  dog.resume();
  dog.touch("assistant");
  dog.touch("status");
  assert.equal(dog["lastEvent"], "assistant", "a status frame is not progress");
  dog.suspend();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stalls.length, 0, "a suspended window never fires");
  dog.resume();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].lastEvent, "assistant");
  dog.stop();
});

test("the watchdog is disabled by a zero window", async () => {
  const stalls: any[] = [];
  const dog = new StallWatchdog({ timeoutMs: 0, onStall: (info) => stalls.push(info) });
  dog.resume();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stalls.length, 0);
});

test("the catalog answers synchronously, refreshes in the background and remembers the snapshot", async () => {
  let now = 1_000;
  let calls = 0;
  const persisted: any[] = [];
  const live: any[] = [];
  const catalog = new ModelCatalog({
    listModels: async () => {
      calls++;
      return [{ id: "default" }, { id: "claude" }];
    },
    resolveApiKey: async () => "k",
    now: () => now,
    freshMs: 100,
    retryMs: 10,
    persist: (snapshot) => persisted.push(snapshot),
    onLive: (opts) => live.push(opts),
  });

  assert.deepEqual(catalog.current().map((m) => m.id).slice(0, 1), ["default"], "fallback models answer a cold start");
  assert.equal(catalog.stale(), true);

  catalog.load({ models: [{ id: "cached" }], live: true, fetchedAt: 1_000 });
  now = 1_500;
  assert.deepEqual(catalog.current(), [{ id: "cached" }], "a stale snapshot still answers without a fetch");
  assert.equal(calls, 0, "reading the catalog never fetches");

  catalog.note();
  await tick();
  assert.equal(calls, 1, "the refresh ran off the request path");
  assert.deepEqual(persisted.at(-1).models.map((m: any) => m.id), ["default", "claude"]);
  assert.deepEqual(live, [{ apiKey: "k", modelId: "default" }]);
  assert.equal(catalog.stale(), false);
});

test("a failed catalog fetch keeps the last snapshot and retries sooner", async () => {
  let now = 0;
  let fail = false;
  const catalog = new ModelCatalog({
    listModels: async () => {
      if (fail) throw new Error("offline");
      return [{ id: "first" }];
    },
    resolveApiKey: async () => "k",
    now: () => now,
    freshMs: 1_000,
    retryMs: 100,
  });
  await catalog.refresh();
  fail = true;
  now = 1_100;
  await catalog.refresh();
  assert.deepEqual(catalog.current(), [{ id: "first" }], "the last good snapshot survives a failure");
  assert.equal(catalog.stale(), false);
  now = 1_250;
  assert.equal(catalog.stale(), true, "a failed fetch retries on the short window");
});

test("the accepted context tier is remembered and invalid entries are ignored", () => {
  const saved: any[] = [];
  const tiers = new ContextTierStore({ claude: "300k", broken: 5 as any }, (values) => saved.push(values));
  assert.equal(tiers.get("claude"), "300k");
  assert.equal(tiers.get("broken"), undefined, "non-string values are dropped");
  tiers.set("claude", "300k");
  assert.equal(saved.length, 0, "an unchanged value is not rewritten");
  tiers.set("gpt", "128k");
  assert.deepEqual(saved.at(-1), { claude: "300k", gpt: "128k" });
});

test("settings resolve with documented defaults and tolerate bad values", () => {
  const base = resolveSettings(undefined, {});
  assert.deepEqual(base.policy, { context: "max", contextWindow: "auto", contextWindows: {}, maxMode: "off", fast: "off" });
  assert.equal(base.stallTimeoutMs, 120_000);

  const tuned = resolveSettings(
    { apiKeyEnv: "K", context: "300k", contextWindow: "400000", fast: "on", maxMode: "on", stallTimeoutMs: 5_000 } as any,
    { DSH_CURSOR_CONTEXT: "min", DSH_CURSOR_STALL_TIMEOUT_MS: "9000" },
  );
  assert.deepEqual(tuned.policy, { context: "min", contextWindow: 400_000, contextWindows: {}, maxMode: "on", fast: "on" });
  assert.equal(tuned.stallTimeoutMs, 9_000, "the environment wins over the config");

  const bad = resolveSettings({ apiKeyEnv: "K", context: "", contextWindow: "nope", fast: "sometimes", maxMode: "maybe", stallTimeoutMs: -1 } as any, {});
  assert.deepEqual(bad.policy, { context: "max", contextWindow: "auto", contextWindows: {}, maxMode: "off", fast: "off" });
  assert.equal(bad.stallTimeoutMs, 120_000);

  const mapped = resolveSettings(
    { apiKeyEnv: "K", contextWindows: { deepseek: 1_000_000, "*": "500000", bad: -3, alsoBad: "nope" } } as any,
    {},
  );
  assert.deepEqual(mapped.policy.contextWindows, { deepseek: 1_000_000, "*": 500_000 });
});

test("the advertised window follows the accepted tier unless it is set explicitly", () => {
  const model = { parameters: [{ id: "context", values: [{ value: "200k" }, { value: "300k" }, { value: "1m" }] }] };
  assert.equal(advertisedContextWindow("m", model, undefined, DEFAULT_POLICY), 1_000_000);
  assert.equal(advertisedContextWindow("m", model, "300k", DEFAULT_POLICY), 300_000);
  assert.equal(advertisedContextWindow("m", model, "300k", { ...DEFAULT_POLICY, contextWindow: 400_000 }), 400_000);
  assert.equal(advertisedContextWindow("m", {}, undefined, DEFAULT_POLICY), 200_000, "a model without tiers keeps the documented default");
});

test("Reply emits balanced DSH blocks, usage, then one finish", async () => {
  const queue = new ChunkQueue();
  const reply = new Reply(queue);
  reply.thinking("hm");
  reply.text("a");
  reply.text("b");
  reply.toolCalls([
    { id: "c1", name: "read", arguments: { path: "x" } },
    { id: "c1", name: "read", arguments: { path: "x" } },
  ]);
  reply.usage = { inputTokens: 1, outputTokens: 2 };
  reply.finish("toolUse");
  reply.finish("error", "late");
  const chunks: any[] = [];
  for await (const c of queue) chunks.push(c);
  assert.deepEqual(
    chunks.map((c) => `${c.type}:${c.index ?? ""}`),
    ["block-start:0", "reasoning-delta:0", "block-end:0", "block-start:1", "text-delta:1", "text-delta:1", "block-end:1", "block-start:2", "tool-call-delta:2", "block-end:2", "usage:", "finish:"],
  );
  assert.deepEqual(chunks[6].block, { type: "text", text: "ab" });
  assert.deepEqual(chunks[9].block, { type: "tool-call", id: "c1", name: "read", arguments: '{"path":"x"}' });
  assert.deepEqual(chunks.at(-1).reason, { kind: "tool-calls" });
  assert.deepEqual(reply.message.content.map((b: any) => b.type), ["thinking", "text", "toolCall"]);
});

test("Reply errors carry a non-retryable code, and a stalled run has its own", async () => {
  const queue = new ChunkQueue();
  new Reply(queue).finish("error", "boom");
  const chunks: any[] = [];
  for await (const c of queue) chunks.push(c);
  assert.deepEqual(chunks, [{ type: "finish", reason: { kind: "error", failure: { message: "boom", code: "CURSOR_RUN_FAILED" } } }]);

  const stalled = new ChunkQueue();
  new Reply(stalled).finish("error", "no content", "CURSOR_RUN_STALLED");
  const out: any[] = [];
  for await (const c of stalled) out.push(c);
  assert.equal(out.at(-1).reason.failure.code, "CURSOR_RUN_STALLED");
});

test("every plugin error code is outside the host's default retry list", async () => {
  const { resolveRetryPolicy } = await import("@deepseek-ai/dsh-llm");
  const policy: any = resolveRetryPolicy(undefined, "cursor");
  assert.equal(policy.mode, "normal");
  for (const code of ["CURSOR_RUN_FAILED", "CURSOR_RUN_STALLED", "MISSING_CREDENTIAL", "ABORTED", "UNSUPPORTED_OPTION"]) {
    assert.ok(!policy.retryableCodes.includes(code), `${code} must not be retried`);
  }
});

test("readRequest: latest system message wins, tool names come from the calls", () => {
  const t = readRequest({
    messages: [
      { id: "s1", role: "system", content: [{ type: "text", text: "OLD" }] },
      { id: "u1", role: "user", content: [{ type: "text", text: "hi" }, { type: "image", attachment: {} }] },
      { id: "d1", role: "developer", content: [{ type: "tool-addition", toolName: "x" }] },
      { id: "a1", role: "assistant", content: [{ type: "reasoning", text: "r" }, { type: "tool-call", id: "c1", name: "read", arguments: '{"path":"a"}' }] },
      { id: "t1", role: "tool", toolCallId: "c1", isError: true, content: [{ type: "text", text: "A" }] },
      { id: "s2", role: "system", content: [{ type: "text", text: "NEW" }] },
    ],
    tools: [{ name: "read", description: "Read", parameters: { type: "object" } }, { description: "nameless" }],
  });
  assert.equal(t.systemPrompt, "NEW");
  assert.deepEqual(t.tools, [{ name: "read", description: "Read", parameters: { type: "object" } }]);
  assert.deepEqual(t.messages, [
    { role: "user", content: [{ type: "text", text: "hi" }, { type: "text", text: "[image attachment not forwarded to Cursor]" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "r" }, { type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } }] },
    { role: "toolResult", toolCallId: "c1", toolName: "read", isError: true, content: [{ type: "text", text: "A" }] },
  ]);
  assert.equal(readRequest({ system: "ONE-SHOT", messages: [] }).systemPrompt, "ONE-SHOT");
});

test("session keys: DSH session id, but auxiliary calls get their own", () => {
  const t = { systemPrompt: "S", tools: [], messages: [{ role: "user", content: "hi" }] };
  assert.equal(sessionKeyFor("sess", t), "sess");
  assert.match(sessionKeyFor("sess", t, "session-title"), /^anon:/);
  assert.notEqual(sessionKeyFor("sess", t, "session-title"), sessionKeyFor("sess", t, "compaction"));
  assert.equal(sessionKeyFor(undefined, t), sessionKeyFor("", t));
});

test("the registry keeps a reusable session per key and closes the oldest beyond its slots", () => {
  const registry = new SessionRegistry(1);
  const make = (signature: string) => ({ key: "k", signature, busy: false, closed: false, closedNow: false, close() { this.closed = true; } }) as any;
  const first = make("a");
  registry.store(first);
  const second = make("b");
  registry.store(second);
  assert.equal(first.closed, true, "the slot beyond the limit is closed");
  assert.equal(registry.count(), 1);
  assert.equal(registry.find("k", "b"), second);
  assert.equal(registry.find("k", "a"), undefined);
  registry.drop(second);
  assert.equal(registry.count(), 0);
});

test("the accepted tier survives a restart through the state file", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-to-dsh-tiers-"));
  try {
    assert.equal(resolveStateDir({ HOME: dir } as NodeJS.ProcessEnv), join(dir, ".dsh"));
    assert.equal(pluginStateDir(dir), join(dir, "cursor-to-dsh"));
    const file = join(pluginStateDir(dir), "context-tiers.json");

    const first = new ContextTierStore({}, (tiers) => writeJsonFile(file, { version: 1, tiers }));
    first.set("claude", "300k");
    assert.deepEqual(readJsonFile<TierFile>(file), { version: 1, tiers: { claude: "300k" } });

    const restarted = new ContextTierStore(ContextTierStore.from(readJsonFile<TierFile>(file)));
    assert.equal(restarted.get("claude"), "300k", "the next process starts from the tier that worked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the catalog snapshot survives a restart without a fetch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-to-dsh-catalog-"));
  try {
    const file = join(dir, "catalog.json");
    let calls = 0;
    const first = new ModelCatalog({
      listModels: async () => {
        calls++;
        return [{ id: "claude" }, { id: "default" }];
      },
      resolveApiKey: async () => "k",
      persist: (snapshot) => writeJsonFile(file, { version: 1, ...snapshot }),
    });
    await first.refresh();

    const restarted = new ModelCatalog({
      listModels: async () => {
        calls++;
        return [];
      },
      resolveApiKey: async () => "k",
    });
    restarted.load(readJsonFile(file));
    assert.deepEqual(restarted.current().map((m) => m.id), ["claude", "default"]);
    assert.equal(calls, 1, "the restart read the file instead of fetching");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stall diagnostic is appended as one JSON line", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-to-dsh-stall-"));
  try {
    const record = createStallDiagnostics(dir);
    record({ key: "sess-1234567890", model: "claude", elapsedMs: 120_000, lastEvent: "assistant" });
    record({ key: "sess-abcdefghij", model: "claude", elapsedMs: 90_000, lastEvent: "status" });
    const lines = readFileSync(join(dir, "stall.log"), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const parsed = JSON.parse(lines[0].slice(lines[0].indexOf(" ") + 1));
    assert.deepEqual(parsed, { key: "sess-1234567890", model: "claude", elapsedMs: 120_000, lastEvent: "assistant" });
    assert.ok(lines[0].startsWith("20"), "each line starts with an ISO timestamp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an existing ripgrep path is kept, a stale one is replaced", () => {
  assert.equal(configureRipgrep({ CURSOR_RIPGREP_PATH: process.execPath } as any), process.execPath);
  const env: any = { CURSOR_RIPGREP_PATH: "/gone/rg" };
  const found = configureRipgrep(env);
  assert.notEqual(found, "/gone/rg");
  if (found) assert.equal(env.CURSOR_RIPGREP_PATH, found);
});

test("prewarm: one throwaway agent per process, run cancelled, agent closed, failures swallowed", async () => {
  resetPrewarm();
  const log: string[] = [];
  const create = async (opts: any) => {
    log.push(`create ${opts.model.id} ${opts.local.cwd.endsWith("cursor-to-dsh-warmup")}`);
    return {
      send: async (text: string) => {
        log.push(`send ${text}`);
        return { cancel: async () => log.push("cancel"), wait: async () => log.push("wait") };
      },
      close: () => log.push("close"),
    };
  };
  await prewarmCursor({ apiKey: "k", modelId: "default" }, create);
  await prewarmCursor({ apiKey: "k", modelId: "other" }, create);
  assert.deepEqual(log, ["create default true", "send .", "cancel", "wait", "close"]);

  resetPrewarm();
  await prewarmCursor({ apiKey: "k", modelId: "default" }, async () => {
    throw new Error("offline");
  });
  resetPrewarm();
});
