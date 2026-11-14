import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTimingSink, StepTiming, type StepRecord } from "../src/session/timing.ts";

const record = (key: string): StepRecord => ({
  time: new Date().toISOString(),
  key,
  model: "m",
  reused: false,
  windowMs: 0,
  outcome: "stop",
  durationMs: 1,
});

test("a step record carries the marks it was given and nothing else", () => {
  let now = 1000;
  const step = new StepTiming("sess", "m", 0, { now: () => now });
  step.reuse();
  now = 1010;
  step.sent();
  now = 1040;
  step.content();
  step.note({ tools: 2, sentChars: 120, usage: { inputTokens: 5, outputTokens: 1 } });
  step.noteDelta({ type: "token-delta", tokens: 4 });
  step.noteDelta({ type: "token-delta", tokens: 5 });
  step.noteDelta({ type: "step-completed", stepDurationMs: 42 });
  step.chunk("text");
  step.chunk("thinking");
  now = 1060;
  const out = step.finish("tool-calls");
  assert.equal(out.key, "sess");
  assert.equal(out.model, "m");
  assert.equal(out.reused, true);
  assert.equal(out.outcome, "tool-calls");
  assert.equal(out.windowMs, 0);
  assert.equal(out.preSendMs, 10);
  assert.equal(out.firstContentMs, 40);
  assert.equal(out.durationMs, 60);
  assert.equal(out.tools, 2);
  assert.equal(out.sentChars, 120);
  assert.equal(out.streamedTokens, 9);
  assert.equal(out.stepDurationMs, 42);
  assert.equal(out.textChunks, 1);
  assert.equal(out.thinkingChunks, 1);
  assert.deepEqual(out.usage, { inputTokens: 5, outputTokens: 1 });
  assert.equal("lateSiblingMs" in out, false, "a field the call did not observe stays absent");
});

test("the first send and the first content marks win", () => {
  let now = 0;
  const step = new StepTiming("s", "m", 7, { now: () => now });
  now = 5;
  step.sent();
  now = 9;
  step.sent();
  now = 20;
  step.content();
  now = 30;
  step.content();
  const out = step.finish("stop");
  assert.equal(out.preSendMs, 5);
  assert.equal(out.firstContentMs, 20);
  assert.equal(out.windowMs, 7);
});

test("a record without a send or content omits both times", () => {
  const out = new StepTiming("s", "m", 0).finish("error");
  assert.equal("preSendMs" in out, false);
  assert.equal("firstContentMs" in out, false);
  assert.ok(out.durationMs >= 0);
});

test("the sink buffers a record and appends it off the call's path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-to-dsh-timing-"));
  try {
    const write = createTimingSink(dir);
    write(record("a"));
    write(record("b"));
    assert.equal(existsSync(join(dir, "timing.log")), false, "the call does not wait for the write");
    await new Promise((resolve) => setImmediate(resolve));
    const lines = readFileSync(join(dir, "timing.log"), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => JSON.parse(line).key), ["a", "b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a sink that cannot write loses the record and nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-to-dsh-timing-bad-"));
  try {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    const write = createTimingSink(join(blocker, "nested"));
    assert.doesNotThrow(() => write(record("a")));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
