import { test } from "node:test";
import assert from "node:assert/strict";

import { apply } from "../src/client/index.ts";

const payload = {
  version: 1,
  provider: "cursor",
  rowId: "custom-row",
  settingsNs: "custom-row",
  knownContext: { enabled: true },
  models: [],
};

function bench(fetchCatalog: () => Promise<any>) {
  const registered: string[] = [];
  let declare: (() => () => void) | undefined;
  let dispose: (() => void) | undefined;
  const ctx: any = {
    effect: (fn: () => any) => fn(),
    remote: {},
    slots: {
      inject: (_name: string, callback: () => () => void) => {
        declare = callback;
        dispose = callback();
        return () => {};
      },
      register: (options: any) => {
        registered.push(options.key);
        return () => {};
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchCatalog as any;
  try {
    apply(ctx);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { registered, redeclare: () => { dispose?.(); declare?.(); } };
}

test("apply registers the row's Configure page under the packaged row id", () => {
  const { registered } = bench(async () => ({ ok: true, json: async () => payload }));
  assert.deepEqual(registered, ["cursor-to-dsh#llm-cursor"]);
});

test("a renamed row id reported by the route is registered too, and survives a re-declaration", async () => {
  const { registered, redeclare } = bench(async () => ({ ok: true, json: async () => payload }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(registered.includes("cursor-to-dsh#custom-row"), "the discovered row id is registered");

  registered.length = 0;
  redeclare();
  assert.deepEqual(registered.sort(), ["cursor-to-dsh#custom-row", "cursor-to-dsh#llm-cursor"]);
});

test("an unavailable route keeps the default row and never throws", async () => {
  const { registered } = bench(async () => {
    throw new Error("route answered 401");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(registered, ["cursor-to-dsh#llm-cursor"]);
});
