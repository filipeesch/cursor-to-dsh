import { test } from "node:test";
import assert from "node:assert/strict";

import { warmUpAtStart } from "../src/warmup.ts";

const models = () => [{ id: "other" }, { id: "default" }];

test("warm-up starts at apply from the known models", async () => {
  const calls: any[] = [];
  await warmUpAtStart({
    enabled: true,
    resolveApiKey: async () => "k",
    models,
    prewarm: async (options) => {
      calls.push(options);
    },
  });
  assert.deepEqual(calls, [{ apiKey: "k", modelId: "default" }]);
});

test("the first known model is used when there is no default", async () => {
  const calls: any[] = [];
  await warmUpAtStart({
    enabled: true,
    resolveApiKey: async () => "k",
    models: () => [{ id: "m" }],
    prewarm: async (options) => {
      calls.push(options);
    },
  });
  assert.deepEqual(calls, [{ apiKey: "k", modelId: "m" }]);
});

test("warm-up is skipped when disabled, without a credential or without a model", async () => {
  let calls = 0;
  const prewarm = async () => {
    calls++;
  };
  await warmUpAtStart({ enabled: false, resolveApiKey: async () => "k", models, prewarm });
  await warmUpAtStart({ enabled: true, resolveApiKey: async () => undefined, models, prewarm });
  await warmUpAtStart({ enabled: true, resolveApiKey: async () => "k", models: () => [], prewarm });
  assert.equal(calls, 0);
});

test("a failed warm-up is swallowed", async () => {
  await warmUpAtStart({
    enabled: true,
    resolveApiKey: async () => "k",
    models,
    prewarm: async () => {
      throw new Error("boom");
    },
  });
});

test("a credential lookup that throws is swallowed too", async () => {
  await warmUpAtStart({
    enabled: true,
    resolveApiKey: async () => {
      throw new Error("no service");
    },
    models,
    prewarm: async () => {},
  });
});
