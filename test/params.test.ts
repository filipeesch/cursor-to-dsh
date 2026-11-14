import { test } from "node:test";
import assert from "node:assert/strict";

import { effortFor, modelParams, reasoningInfo } from "../src/model-params.ts";
import { DEFAULT_POLICY } from "../src/policy/types.ts";

const v = (...values: string[]) => values.map((value) => ({ value }));
const claude = [
  { id: "thinking", values: v("true", "false") },
  { id: "effort", values: v("low", "medium", "high", "extra-high", "max") },
  { id: "fast", values: v("true", "false") },
  { id: "context", values: v("200k", "1m") },
];

test("Claude: thinking switch on, effort mapped, Fast off, largest context", () => {
  assert.deepEqual(modelParams({ cursorParameters: claude }, "extra-high"), [
    { id: "thinking", value: "true" },
    { id: "effort", value: "extra-high" },
    { id: "fast", value: "false" },
    { id: "context", value: "1m" },
  ]);
  assert.deepEqual(modelParams({ cursorParameters: claude }, "off"), [
    { id: "thinking", value: "false" },
    { id: "fast", value: "false" },
    { id: "context", value: "1m" },
  ]);
});

test("Fast mode: off by default, on when configured, absent when auto or unsupported", () => {
  const model = { cursorParameters: claude };
  assert.deepEqual(modelParams(model, "high").filter((p) => p.id === "fast"), [{ id: "fast", value: "false" }]);
  assert.deepEqual(
    modelParams(model, "high", { ...DEFAULT_POLICY, fast: "on" }).filter((p) => p.id === "fast"),
    [{ id: "fast", value: "true" }],
  );
  assert.deepEqual(modelParams(model, "high", { ...DEFAULT_POLICY, fast: "auto" }).filter((p) => p.id === "fast"), []);
  const noFast = { cursorParameters: [{ id: "effort", values: v("low", "high") }] };
  assert.deepEqual(modelParams(noFast, "high", { ...DEFAULT_POLICY, fast: "on" }), [{ id: "effort", value: "high" }]);
});

test("a per-model Fast policy overrides the global one", () => {
  const model = { cursorParameters: claude };
  assert.deepEqual(
    modelParams(model, "high", { ...DEFAULT_POLICY, models: { m: { fast: "on" } } }, undefined, "m").filter((p) => p.id === "fast"),
    [{ id: "fast", value: "true" }],
  );
  assert.deepEqual(
    modelParams(model, "high", { ...DEFAULT_POLICY, models: { m: { fast: "auto" } } }, undefined, "m").filter((p) => p.id === "fast"),
    [],
  );
});

test("a per-model tier preference overrides the global one", () => {
  const model = { cursorParameters: claude };
  assert.deepEqual(
    modelParams(model, "high", { ...DEFAULT_POLICY, context: "max", models: { m: { context: "min" } } }, undefined, "m").filter((p) => p.id === "context"),
    [{ id: "context", value: "200k" }],
  );
});

test("effort-only models map off to none and missing levels to the nearest lower", () => {
  const gpt = [{ id: "reasoning_effort", values: v("none", "low", "medium", "high") }];
  assert.deepEqual(modelParams({ cursorParameters: gpt }, "off"), [{ id: "reasoning_effort", value: "none" }]);
  assert.deepEqual(modelParams({ cursorParameters: gpt }, "xhigh"), [{ id: "reasoning_effort", value: "high" }]);
  assert.equal(effortFor(["medium", "high"], "minimal"), "medium");
  assert.equal(effortFor([], "high"), undefined);
  assert.equal(modelParams({ cursorParameters: [] }, "high"), undefined);
});

test("an explicit effort level turns a thinking-only model's switch on", () => {
  const defs = [{ id: "thinking", values: v("true", "false") }];
  assert.deepEqual(modelParams({ cursorParameters: defs }, "on"), [{ id: "thinking", value: "true" }]);
});

test("DSH reasoning efforts follow Cursor's offered values, least to greatest", () => {
  const ids = (model: any) => reasoningInfo(model)?.efforts.map((effort) => effort.id);
  assert.deepEqual(ids({ parameters: claude }), ["off", "low", "medium", "high", "extra-high", "max"]);
  assert.equal(reasoningInfo({ parameters: claude })?.defaultEffort, "high");
  assert.deepEqual(ids({ parameters: [{ id: "reasoning_effort", values: v("high", "none", "low") }] }), ["off", "low", "high"]);
  assert.deepEqual(ids({ parameters: [{ id: "effort", values: v("medium", "xhigh") }] }), ["medium", "xhigh"]);
  assert.equal(reasoningInfo({ parameters: [{ id: "effort", values: v("medium", "xhigh") }] })?.defaultEffort, "xhigh");
  assert.deepEqual(ids({ parameters: [{ id: "thinking", values: v("true", "false") }] }), ["off", "on"]);
  assert.equal(reasoningInfo({ parameters: [{ id: "fast", values: v("false") }] }), undefined);
  assert.equal(reasoningInfo({ id: "default" }), undefined);
});
