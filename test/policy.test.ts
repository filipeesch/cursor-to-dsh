import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSettings } from "../src/config.ts";
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from "../src/policy/context.ts";
import { contextPreferenceFor, entryFor, fastFor, isEnabled } from "../src/policy/model-config.ts";
import { buildPolicy, ModelPolicySource } from "../src/policy/source.ts";
import { DEFAULT_POLICY } from "../src/policy/types.ts";

const v = (...values: string[]) => values.map((value) => ({ value }));
const tiered = {
  parameters: [{ id: "context", values: v("300k", "1m") }],
  variants: [
    { params: [{ id: "context", value: "300k" }], isMaxMode: false },
    { params: [{ id: "context", value: "1m" }], isMaxMode: true },
  ],
};
const undescribed = { parameters: [{ id: "reasoning_effort", values: v("low", "high") }] };

test("configuration resolves into a policy with documented defaults", () => {
  assert.deepEqual(buildPolicy({}), DEFAULT_POLICY);
  assert.deepEqual(buildPolicy({ context: "min", fast: "auto", newModels: "disabled" }), {
    context: "min",
    fast: "auto",
    newModels: "disabled",
    models: {},
  });
});

test("unusable values fall back to the documented default instead of failing", () => {
  const policy = buildPolicy({ context: "300k", fast: "sometimes", newModels: "nope", models: { "": { enabled: true } } });
  assert.equal(policy.context, "max", "a global literal tier is not a preference");
  assert.equal(policy.fast, "off");
  assert.equal(policy.newModels, "enabled");
  assert.deepEqual(policy.models, {}, "an entry with no id is dropped");
});

test("model entries keep only usable fields", () => {
  const policy = buildPolicy({
    models: {
      m: { enabled: false, context: "300k", contextWindow: "400000", fast: "auto" },
      bad: { enabled: "yes", context: "  ", contextWindow: -3, fast: "y" },
      "*": { contextWindow: 1_000_000 },
    },
  });
  assert.deepEqual(policy.models.m, { enabled: false, context: "300k", contextWindow: 400_000, fast: "auto" });
  assert.equal(policy.models.bad, undefined, "an entry with no usable field is dropped");
  assert.deepEqual(policy.models["*"], { contextWindow: 1_000_000 });
});

test("the wildcard entry covers a model without its own", () => {
  const policy = buildPolicy({ fast: "off", models: { "*": { contextWindow: 1_000_000, fast: "on" }, m: { enabled: false } } });
  assert.deepEqual(entryFor(policy, "other"), { contextWindow: 1_000_000, fast: "on" });
  assert.deepEqual(entryFor(policy, "m"), { contextWindow: 1_000_000, fast: "on", enabled: false });
  assert.equal(fastFor(policy, "other"), "on");
  assert.equal(contextPreferenceFor(policy, "other"), "max");
});

test("a model with no entry follows the new-model default", () => {
  assert.equal(isEnabled(DEFAULT_POLICY, "m"), true);
  assert.equal(isEnabled(buildPolicy({ newModels: "disabled" }), "m"), false);
  assert.equal(isEnabled(buildPolicy({ newModels: "disabled", models: { m: { enabled: true } } }), "m"), true);
  assert.equal(isEnabled(buildPolicy({ models: { m: { enabled: false } } }), "m"), false);
});

test("the advertised window comes from the tier the policy will request", () => {
  const window = resolveContextWindow({ modelId: "claude", model: tiered, policy: DEFAULT_POLICY });
  assert.deepEqual(window, { tokens: 1_000_000, source: "tier", tier: "1m" });
  assert.deepEqual(resolveContextWindow({ modelId: "claude", model: tiered, policy: { ...DEFAULT_POLICY, context: "min" } }), {
    tokens: 300_000,
    source: "tier",
    tier: "300k",
  });
  assert.equal(resolveContextWindow({ modelId: "claude", model: tiered, accepted: "300k", policy: DEFAULT_POLICY }).tokens, 300_000);
});

test("the published capacity beats a manual value, and the default comes last", () => {
  const published = resolveContextWindow({ modelId: "deepseek", model: undescribed, policy: { ...DEFAULT_POLICY, models: { deepseek: { contextWindow: 500_000 } } }, publishedWindow: 1_048_576 });
  assert.deepEqual(published, { tokens: 1_048_576, source: "published" });

  const manual = resolveContextWindow({ modelId: "new", model: {}, policy: { ...DEFAULT_POLICY, models: { new: { contextWindow: 500_000 } } } });
  assert.deepEqual(manual, { tokens: 500_000, source: "manual" });

  const fallback = resolveContextWindow({ modelId: "new", model: {}, policy: DEFAULT_POLICY });
  assert.deepEqual(fallback, { tokens: DEFAULT_CONTEXT_WINDOW, source: "default" });
});

test("a model the provider documents fills the gap the catalog and the public catalog leave", () => {
  const window = resolveContextWindow({ modelId: "composer-2.5", model: {}, policy: DEFAULT_POLICY });
  assert.deepEqual(window, { tokens: 200_000, source: "documented" });
  assert.deepEqual(resolveContextWindow({ modelId: "composer-2.5", model: {}, policy: DEFAULT_POLICY, publishedWindow: 1_048_576 }), {
    tokens: 1_048_576,
    source: "published",
  }, "a published capacity still wins");
  assert.equal(
    resolveContextWindow({ modelId: "composer-2.5", model: {}, policy: { ...DEFAULT_POLICY, models: { "composer-2.5": { contextWindow: 500_000 } } } }).source,
    "manual",
    "a manual value overrides the documented capacity",
  );
  assert.equal(resolveContextWindow({ modelId: "composer-2", model: {}, policy: DEFAULT_POLICY }).source, "default");
});

test("a manual value never overrides a provider tier", () => {
  const window = resolveContextWindow({ modelId: "claude", model: tiered, policy: { ...DEFAULT_POLICY, models: { claude: { contextWindow: 400_000 } } } });
  assert.deepEqual(window, { tokens: 1_000_000, source: "tier", tier: "1m" });
});

test("the policy source reads the live configuration on every call", () => {
  let current: any = { fast: "off" };
  const source = new ModelPolicySource(() => current);
  assert.equal(source.current().fast, "off");
  current = { fast: "on", models: { m: { enabled: false } } };
  assert.equal(source.current().fast, "on");
  assert.equal(source.current().models.m.enabled, false);
});

test("settings resolve to readers, not frozen values", () => {
  const settings = resolveSettings(undefined, {});
  assert.equal(settings.stallTimeoutMs, 120_000);
  assert.equal(settings.knownContext(), true);
  assert.deepEqual(settings.readPolicy(), DEFAULT_POLICY);

  const off = resolveSettings({ knownContext: "off", stallTimeoutMs: 5_000 } as any, {});
  assert.equal(off.knownContext(), false);
  assert.equal(off.stallTimeoutMs, 5_000);

  const env = resolveSettings({ stallTimeoutMs: 5_000 } as any, { DSH_CURSOR_CONTEXT: "min", DSH_CURSOR_STALL_TIMEOUT_MS: "9000" });
  assert.equal(env.readPolicy().context, "min", "the environment wins over the configuration");
  assert.equal(env.stallTimeoutMs, 9_000);

  const bad = resolveSettings({ stallTimeoutMs: -1, knownContext: "perhaps" } as any, {});
  assert.equal(bad.stallTimeoutMs, 120_000);
  assert.equal(bad.knownContext(), true, "only an explicit off disables the fetch");
});
