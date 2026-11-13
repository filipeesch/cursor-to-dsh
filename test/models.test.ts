import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_POLICY,
  advertisedContextWindow,
  contextTierValue,
  effortFor,
  isRejectedParams,
  modelParams,
  preferredContext,
  reasoningInfo,
  requiresMaxMode,
  resolveModelId,
  smallerContext,
} from "../src/models.ts";

const v = (...values: string[]) => values.map((value) => ({ value }));
const claude = [
  { id: "thinking", values: v("true", "false") },
  { id: "effort", values: v("low", "medium", "high", "extra-high", "max") },
  { id: "fast", values: v("true", "false") },
  { id: "context", values: v("200k", "1m") },
];

test("only auto is aliased", () => {
  assert.equal(resolveModelId("auto"), "default");
  assert.equal(resolveModelId("claude-opus-5-5"), "claude-opus-5-5");
});

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

test("effort-only models map off to none and missing levels to the nearest lower", () => {
  const gpt = [{ id: "reasoning_effort", values: v("none", "low", "medium", "high") }];
  assert.deepEqual(modelParams({ cursorParameters: gpt }, "off"), [{ id: "reasoning_effort", value: "none" }]);
  assert.deepEqual(modelParams({ cursorParameters: gpt }, "xhigh"), [{ id: "reasoning_effort", value: "high" }]);
  assert.equal(effortFor(["medium", "high"], "minimal"), "medium");
  assert.equal(effortFor([], "high"), undefined);
  assert.equal(modelParams({ cursorParameters: [] }, "high"), undefined);
});

test("context preference: largest by default, exact match, env override, step-down", () => {
  const def = { id: "context", values: v("200k", "300k", "1m") };
  assert.equal(preferredContext(def, "max")?.value, "1m");
  assert.equal(preferredContext(def, "min")?.value, "200k");
  assert.equal(preferredContext(def, "300K")?.value, "300k");
  assert.equal(preferredContext(def, "bogus")?.value, "200k");
  assert.equal(preferredContext(def)?.value, "1m", "the default is the largest offered");
  process.env.DSH_CURSOR_CONTEXT = "300k";
  try {
    assert.equal(preferredContext(def)?.value, "1m", "the model layer reads no ambient state");
  } finally {
    delete process.env.DSH_CURSOR_CONTEXT;
  }

  const model = { cursorParameters: [def] };
  assert.equal(advertisedContextWindow("m", model, undefined), 1_000_000);
  assert.equal(advertisedContextWindow("m", {}, undefined), DEFAULT_CONTEXT_WINDOW);
  assert.deepEqual(smallerContext(model, [{ id: "fast", value: "false" }, { id: "context", value: "1m" }]), [
    { id: "fast", value: "false" },
    { id: "context", value: "300k" },
  ]);
  assert.equal(smallerContext(model, [{ id: "context", value: "200k" }]), undefined);
  assert.ok(isRejectedParams('Invalid parameters for registry model: "m"'));
});

const tiered = {
  cursorParameters: [{ id: "context", values: v("300k", "1m") }],
  variants: [
    { params: [{ id: "context", value: "300k" }], isMaxMode: false },
    { params: [{ id: "context", value: "1m" }], isMaxMode: true },
  ],
};
const undescribed = { cursorParameters: [{ id: "reasoning_effort", values: v("low", "high") }] };

test("the accepted tier wins over the preference when the policy allows it", () => {
  const model = { cursorParameters: [{ id: "context", values: v("200k", "300k", "1m") }] };
  assert.equal(contextTierValue(model, undefined, "max"), "1m");
  assert.equal(contextTierValue(model, "300k", "max"), "300k");
  assert.equal(contextTierValue(model, "gone", "max"), "1m");
  assert.deepEqual(modelParams(model, "high", { ...DEFAULT_POLICY, context: "min" }, "300k"), [{ id: "context", value: "300k" }]);
});

test("Max Mode is off by default: the largest non-Max tier is chosen and advertised", () => {
  assert.deepEqual(modelParams(tiered, "high").filter((p) => p.id === "context"), [{ id: "context", value: "300k" }]);
  assert.equal(advertisedContextWindow("claude", tiered, undefined), 300_000);

  const on = { ...DEFAULT_POLICY, maxMode: "on" as const };
  assert.deepEqual(modelParams(tiered, "high", on).filter((p) => p.id === "context"), [{ id: "context", value: "1m" }]);
  assert.equal(advertisedContextWindow("claude", tiered, undefined, on), 1_000_000);

  const auto = { ...DEFAULT_POLICY, maxMode: "auto" as const };
  assert.equal(advertisedContextWindow("claude", tiered, undefined, auto), 1_000_000);
  assert.equal(requiresMaxMode(tiered, "1m"), true);
  assert.equal(requiresMaxMode(tiered, "300k"), false);
});

test("an accepted tier the policy forbids is not reused", () => {
  assert.equal(contextTierValue(tiered, "1m", "max", "off"), "300k");
  assert.equal(contextTierValue(tiered, "1m", "max", "on"), "1m");
});

test("a tier the catalog does not mark stays selectable while the policy is off", () => {
  const unmarked = { cursorParameters: [{ id: "context", values: v("256k", "500k") }], variants: [] as any[] };
  assert.equal(requiresMaxMode(unmarked, "500k"), false);
  assert.equal(contextTierValue(unmarked, undefined, "max", "off"), "500k");
});

test("window precedence: model entry, wildcard, global value, tier, documented default", () => {
  assert.equal(advertisedContextWindow("deepseek-v41-flash-1017", undescribed, undefined), DEFAULT_CONTEXT_WINDOW);

  const wildcard = { ...DEFAULT_POLICY, contextWindows: { "*": 1_000_000 } };
  assert.equal(advertisedContextWindow("deepseek-v41-flash-1017", undescribed, undefined, wildcard), 1_000_000);

  const specific = { ...DEFAULT_POLICY, contextWindows: { "*": 1_000_000, "deepseek-v41-flash-1017": 500_000 } };
  assert.equal(advertisedContextWindow("deepseek-v41-flash-1017", undescribed, undefined, specific), 500_000);
  assert.equal(advertisedContextWindow("other", undescribed, undefined, specific), 1_000_000);

  assert.equal(advertisedContextWindow("claude", tiered, undefined, { ...DEFAULT_POLICY, contextWindow: 400_000 }), 400_000);
  assert.equal(advertisedContextWindow("claude", tiered, "1m", { ...DEFAULT_POLICY, maxMode: "on" }), 1_000_000);
});

test("DSH reasoning efforts follow Cursor's offered values, least to greatest", () => {
  const ids = (m: any) => reasoningInfo(m)?.efforts.map((e) => e.id);
  assert.deepEqual(ids({ parameters: claude }), ["off", "low", "medium", "high", "extra-high", "max"]);
  assert.equal(reasoningInfo({ parameters: claude })?.defaultEffort, "high");
  assert.deepEqual(ids({ parameters: [{ id: "reasoning_effort", values: v("high", "none", "low") }] }), ["off", "low", "high"]);
  assert.deepEqual(ids({ parameters: [{ id: "effort", values: v("medium", "xhigh") }] }), ["medium", "xhigh"]);
  assert.equal(reasoningInfo({ parameters: [{ id: "effort", values: v("medium", "xhigh") }] })?.defaultEffort, "xhigh");
  assert.deepEqual(ids({ parameters: [{ id: "thinking", values: v("true", "false") }] }), ["off", "on"]);
  assert.equal(reasoningInfo({ parameters: [{ id: "fast", values: v("false") }] }), undefined);
  assert.equal(reasoningInfo({ id: "default" }), undefined);
});

test("an explicit effort level turns a thinking-only model's switch on", () => {
  const defs = [{ id: "thinking", values: v("true", "false") }];
  assert.deepEqual(modelParams({ cursorParameters: defs }, "on"), [{ id: "thinking", value: "true" }]);
});
