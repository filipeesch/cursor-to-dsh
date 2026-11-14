import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contextTierValue,
  isRejectedParams,
  offeredTiers,
  preferredContext,
  smallerContext,
  tierTokens,
  tierTokensValue,
} from "../src/model-tiers.ts";

const v = (...values: string[]) => values.map((value) => ({ value }));
const def = { id: "context", values: v("200k", "300k", "1m") };
const tiered = { parameters: [def] };

test("a tier value parses to tokens and anything else is unknown", () => {
  assert.equal(tierTokensValue("300k"), 300_000);
  assert.equal(tierTokensValue("1M"), 1_000_000);
  assert.equal(tierTokensValue("2.5k"), 2_500);
  assert.equal(tierTokensValue("max"), undefined);
  assert.equal(tierTokensValue(""), undefined);
});

test("offered tiers are sorted and their tokens resolved", () => {
  assert.deepEqual(offeredTiers(tiered), [
    { value: "200k", tokens: 200_000 },
    { value: "300k", tokens: 300_000 },
    { value: "1m", tokens: 1_000_000 },
  ]);
  assert.equal(tierTokens(tiered, "300K"), 300_000);
  assert.deepEqual(offeredTiers({}), []);
});

test("the preference selects the largest, the smallest, an exact value or the smallest fallback", () => {
  assert.equal(preferredContext(tiered, "max")?.value, "1m");
  assert.equal(preferredContext(tiered, "min")?.value, "200k");
  assert.equal(preferredContext(tiered, "300K")?.value, "300k");
  assert.equal(preferredContext(tiered, "bogus")?.value, "200k");
  assert.equal(preferredContext({ parameters: [] }, "max"), undefined);
});

test("the tier in effect honours an accepted tier the catalog still offers", () => {
  assert.equal(contextTierValue(tiered, undefined, "max"), "1m");
  assert.equal(contextTierValue(tiered, "300k", "max"), "300k");
  assert.equal(contextTierValue(tiered, "gone", "max"), "1m");
  assert.equal(contextTierValue(tiered, undefined, "min"), "200k");
  assert.equal(contextTierValue({ parameters: [] }, undefined, "max"), undefined);
});

test("a rejected tier steps down to the next smaller offered one", () => {
  assert.deepEqual(smallerContext(tiered, [{ id: "fast", value: "false" }, { id: "context", value: "1m" }]), [
    { id: "fast", value: "false" },
    { id: "context", value: "300k" },
  ]);
  assert.equal(smallerContext(tiered, [{ id: "context", value: "200k" }]), undefined);
  assert.equal(smallerContext(tiered, undefined), undefined);
  assert.ok(isRejectedParams('Invalid parameters for registry model: "m"'));
  assert.equal(isRejectedParams("boom"), false);
});
