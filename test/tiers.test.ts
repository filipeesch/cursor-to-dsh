import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contextTierValue,
  hasMaxModeVariants,
  isRejectedParams,
  offeredTiers,
  preferredContext,
  requiresMaxMode,
  smallerContext,
  tierTokens,
  tierTokensValue,
} from "../src/model-tiers.ts";

const v = (...values: string[]) => values.map((value) => ({ value }));
const def = { id: "context", values: v("200k", "300k", "1m") };
const tiered = {
  parameters: [def],
  variants: [
    { params: [{ id: "context", value: "300k" }], isMaxMode: false },
    { params: [{ id: "context", value: "1m" }], isMaxMode: true },
  ],
};

test("a tier value parses to tokens and anything else is unknown", () => {
  assert.equal(tierTokensValue("300k"), 300_000);
  assert.equal(tierTokensValue("1M"), 1_000_000);
  assert.equal(tierTokensValue("2.5k"), 2_500);
  assert.equal(tierTokensValue("max"), undefined);
  assert.equal(tierTokensValue(""), undefined);
});

test("offered tiers are sorted and their tokens resolved", () => {
  assert.deepEqual(offeredTiers({ parameters: [def] }), [
    { value: "200k", tokens: 200_000 },
    { value: "300k", tokens: 300_000 },
    { value: "1m", tokens: 1_000_000 },
  ]);
  assert.equal(tierTokens({ parameters: [def] }, "300K"), 300_000);
  assert.deepEqual(offeredTiers({}), []);
});

test("the preference selects the largest, the smallest, an exact value or the smallest fallback", () => {
  assert.equal(preferredContext({ parameters: [def] }, "max")?.value, "1m");
  assert.equal(preferredContext({ parameters: [def] }, "min")?.value, "200k");
  assert.equal(preferredContext({ parameters: [def] }, "300K")?.value, "300k");
  assert.equal(preferredContext({ parameters: [def] }, "bogus")?.value, "200k");
  assert.equal(preferredContext({ parameters: [] }, "max"), undefined);
});

test("the tier in effect honours an accepted tier the policy still allows", () => {
  assert.equal(contextTierValue({ parameters: [def] }, undefined, "max", "off"), "1m");
  assert.equal(contextTierValue({ parameters: [def] }, "300k", "max", "off"), "300k");
  assert.equal(contextTierValue({ parameters: [def] }, "gone", "max", "off"), "1m");
  assert.equal(contextTierValue({ parameters: [def] }, undefined, "min", "off"), "200k");
});

test("Max Mode policy decides which tiers are requestable", () => {
  assert.equal(requiresMaxMode(tiered, "1m"), true);
  assert.equal(requiresMaxMode(tiered, "300k"), false);
  assert.equal(requiresMaxMode({ parameters: [def] }, "1m"), false, "an unmarked tier is not treated as Max Mode");
  assert.equal(hasMaxModeVariants(tiered), true);
  assert.equal(hasMaxModeVariants({ parameters: [def] }), false);

  assert.equal(contextTierValue(tiered, undefined, "max", "off"), "300k");
  assert.equal(contextTierValue(tiered, undefined, "max", "on"), "1m");
  assert.equal(contextTierValue(tiered, undefined, "max", "auto"), "1m");
  assert.equal(contextTierValue(tiered, "1m", "max", "off"), "300k", "an accepted Max Mode tier is not reused while the policy is off");
  assert.equal(contextTierValue(tiered, "1m", "max", "on"), "1m");
});

test("a tier the catalog does not mark stays selectable while Max Mode is off", () => {
  const unmarked = { parameters: [{ id: "context", values: v("256k", "500k") }], variants: [] as any[] };
  assert.equal(requiresMaxMode(unmarked, "500k"), false);
  assert.equal(contextTierValue(unmarked, undefined, "max", "off"), "500k");
});

test("a rejected tier steps down to the next smaller offered one", () => {
  assert.deepEqual(smallerContext({ parameters: [def] }, [{ id: "fast", value: "false" }, { id: "context", value: "1m" }]), [
    { id: "fast", value: "false" },
    { id: "context", value: "300k" },
  ]);
  assert.equal(smallerContext({ parameters: [def] }, [{ id: "context", value: "200k" }]), undefined);
  assert.equal(smallerContext({ parameters: [def] }, undefined), undefined);
  assert.ok(isRejectedParams('Invalid parameters for registry model: "m"'));
  assert.equal(isRejectedParams("boom"), false);
});
