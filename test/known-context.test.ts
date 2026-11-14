import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  KnownContext,
  lastSegment,
  normalizeModelKey,
  projectWindows,
  publishedEntries,
  vendorOf,
} from "../src/cursor/known-context.ts";
import { readGzipJsonFile, writeGzipJsonFile } from "../src/cursor/state.ts";

const catalogue = {
  anthropic: {
    models: {
      "anthropic/claude-opus-5-5": { id: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5", limit: { context: 1_000_000 } },
    },
  },
  openai: {
    models: {
      "openai/gpt-5.5": { id: "openai/gpt-5.5", name: "GPT-5.5", limit: { context: 1_050_000 } },
    },
  },
  "merge-gateway": {
    models: {
      "google/gemini-4-carbon": { id: "google/gemini-4-carbon", name: "Gemini 4 Carbon", limit: { context: 1_048_576 } },
      "gpt-5.5": { id: "gpt-5.5", name: "GPT-5.5", limit: { context: 900_000 } },
      "deepseek/deepseek-v4.1-flash-1017": { id: "deepseek/deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash 1017", limit: { context: 1_048_576 } },
    },
  },
  vertex: {
    models: {
      "claude-sonnet-5-5@default": { id: "claude-sonnet-5-5@default", name: "Claude Sonnet 5.5 @default", limit: { context: 1_000_000 } },
    },
  },
};

test("ids normalize case and punctuation, and the last segment is the model's own name", () => {
  assert.equal(normalizeModelKey("Claude Opus 5.5"), "claudeopus55");
  assert.equal(normalizeModelKey("deepseek-v4.1-flash-1017"), "deepseekv41flash1017");
  assert.equal(lastSegment("google/gemini-4-carbon"), "gemini-4-carbon");
  assert.equal(lastSegment("gemini-4-carbon"), "gemini-4-carbon");
});

test("a vendor is inferred from the model id prefix", () => {
  assert.equal(vendorOf("claude-opus-5-5"), "anthropic");
  assert.equal(vendorOf("gpt-5.5"), "openai");
  assert.equal(vendorOf("gemini-4-carbon"), "google");
  assert.equal(vendorOf("kimi-k3"), "moonshot");
  assert.equal(vendorOf("deepseek-v41-flash-1017"), "deepseek");
  assert.equal(vendorOf("composer-2"), undefined);
  assert.equal(vendorOf("default"), undefined);
});

test("only entries that publish a capacity are read, and a malformed document reads as empty", () => {
  const entries = publishedEntries(catalogue);
  assert.equal(entries.length, 6);
  assert.deepEqual(publishedEntries({}), []);
  assert.deepEqual(publishedEntries(null), []);
  assert.deepEqual(publishedEntries({ p: { models: { a: { limit: { context: -1 } } } } }), []);
});

test("the projection prefers the model's own vendor and never advertises more than the smallest candidate", () => {
  const windows = projectWindows(["claude-opus-5-5", "gpt-5.5", "gemini-4-carbon", "deepseek-v41-flash-1017"], publishedEntries(catalogue));
  assert.equal(windows["claude-opus-5-5"], 1_000_000);
  assert.equal(windows["gpt-5.5"], 1_050_000, "the vendor's own entry wins over a gateway's smaller one");
  assert.equal(windows["gemini-4-carbon"], 1_048_576);
  assert.equal(windows["deepseek-v41-flash-1017"], 1_048_576);
});

test("a model id is never matched by another model's suffix", () => {
  const windows = projectWindows(["default", "composer-2"], publishedEntries(catalogue));
  assert.deepEqual(windows, {}, "the @default variant does not describe the auto entry");
});

test("with no vendor match the smallest candidate is used", () => {
  const entries = [
    { provider: "a-gateway", id: "vendor/kimi-k3", name: "Kimi K3", context: 1_048_576 },
    { provider: "b-gateway", id: "vendor/kimi-k3", name: "Kimi K3", context: 262_144 },
  ];
  assert.deepEqual(projectWindows(["kimi-k3"], entries), { "kimi-k3": 262_144 });
});

test("the snapshot answers without a fetch, refreshes out of band and persists", async () => {
  let now = 1_000;
  let fetches = 0;
  const persisted: any[] = [];
  const known = new KnownContext({
    modelIds: () => ["gpt-5.5"],
    enabled: () => true,
    fetchCatalog: async () => {
      fetches++;
      return catalogue;
    },
    persist: (snapshot) => persisted.push(snapshot),
    freshMs: 100,
    now: () => now,
  });

  assert.equal(known.windowFor("gpt-5.5"), undefined, "a cold snapshot answers undefined");
  known.note();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  assert.equal(known.windowFor("gpt-5.5"), 1_050_000);
  assert.equal(known.stale(), false);
  assert.equal(persisted.at(-1).windows["gpt-5.5"], 1_050_000);

  now = 1_500;
  assert.equal(known.stale(), true);
  known.note();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 2);
});

test("a disabled or empty source never fetches, and a failure keeps the last snapshot", async () => {
  let fetches = 0;
  const disabled = new KnownContext({ modelIds: () => ["m"], enabled: () => false, fetchCatalog: async () => { fetches++; return {}; } });
  disabled.note();
  await disabled.refresh();
  assert.equal(fetches, 0);

  const empty = new KnownContext({ modelIds: () => [], enabled: () => true, fetchCatalog: async () => { fetches++; return {}; } });
  empty.note();
  await empty.refresh();
  assert.equal(fetches, 0, "an empty catalog has nothing to project");

  let fail = false;
  const known = new KnownContext({
    modelIds: () => ["gpt-5.5"],
    enabled: () => true,
    fetchCatalog: async () => {
      if (fail) throw new Error("offline");
      return catalogue;
    },
    now: () => 0,
  });
  await known.refresh();
  assert.equal(known.windowFor("gpt-5.5"), 1_050_000);
  fail = true;
  await known.refresh();
  assert.equal(known.windowFor("gpt-5.5"), 1_050_000, "a failed refresh keeps the previous projection");
});

test("the snapshot round-trips through a gzip file and rejects a malformed document", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-to-dsh-known-"));
  try {
    const file = join(dir, "known.json.gz");
    writeGzipJsonFile(file, { version: 1, fetchedAt: 42, windows: { m: 262_144 } });
    assert.deepEqual(readGzipJsonFile(file), { version: 1, fetchedAt: 42, windows: { m: 262_144 } });

    const known = new KnownContext({ modelIds: () => [], enabled: () => true });
    known.load(readGzipJsonFile(file));
    assert.equal(known.windowFor("m"), 262_144);
    known.load({ version: 2, fetchedAt: 1, windows: { m: 1 } } as any);
    assert.equal(known.windowFor("m"), 262_144, "an unknown version is ignored");
    known.load({ version: 1, fetchedAt: 1, windows: { m: -1, n: "x" } } as any);
    assert.equal(known.windowFor("m"), undefined, "a usable document replaces the snapshot; unusable values are dropped");
    assert.equal(known.windowFor("n"), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
