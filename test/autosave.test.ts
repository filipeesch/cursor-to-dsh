import { test } from "node:test";
import assert from "node:assert/strict";

import { Autosave } from "../src/client/autosave.ts";

const op = (value: string) => [{ op: "set" as const, path: ["models", "m", "context"], value }];

function bench(write?: (ops: any[], revision: number | undefined) => Promise<boolean>) {
  const timers: (() => void)[] = [];
  const writes: { ops: any[]; revision: number | undefined }[] = [];
  const failures: unknown[] = [];
  const autosave = new Autosave({
    write: async (ops, revision) => {
      writes.push({ ops, revision });
      return write ? write(ops, revision) : true;
    },
    onFailure: (error) => failures.push(error),
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length - 1;
    },
    clearTimer: (handle) => {
      timers[handle as number] = () => {};
    },
  });
  return { autosave, timers, writes, failures };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

test("one debounced write per field, with the latest value winning", async () => {
  const { autosave, timers, writes } = bench();
  autosave.schedule("tier", op("300k"), 1);
  autosave.schedule("tier", op("1m"), 1);
  assert.equal(autosave.size, 1, "the second change replaces the first");
  assert.equal(timers.length, 2, "the first timer was cleared and a new one armed");
  for (const timer of timers) timer();
  await settle();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].ops, op("1m"));
  assert.equal(writes[0].revision, 1);
  assert.equal(autosave.size, 0);
});

test("different fields are written independently", async () => {
  const { autosave, timers, writes } = bench();
  autosave.schedule("tier", op("1m"), 2);
  autosave.schedule("fast", [{ op: "set", path: ["models", "m", "fast"], value: "on" }], 2);
  assert.equal(autosave.size, 2);
  for (const timer of timers) timer();
  await settle();
  assert.equal(writes.length, 2);
});

test("a refused write is reported so the page can roll back", async () => {
  const { autosave, timers, failures } = bench(async () => false);
  autosave.schedule("tier", op("1m"), 3);
  for (const timer of timers) timer();
  await settle();
  assert.equal(failures.length, 1);
  assert.match((failures[0] as Error).message, /refused/);
});

test("a transport failure is reported rather than swallowed", async () => {
  const { autosave, timers, failures } = bench(async () => {
    throw new Error("offline");
  });
  autosave.schedule("tier", op("1m"), 3);
  for (const timer of timers) timer();
  await settle();
  assert.equal(failures.length, 1);
});

test("flush writes what is pending without waiting for the debounce", async () => {
  const { autosave, writes } = bench();
  autosave.schedule("tier", op("1m"), 4);
  await autosave.flush();
  assert.equal(writes.length, 1);
  assert.equal(autosave.size, 0);
});

test("dispose flushes the last change and stops accepting new ones", async () => {
  const { autosave, writes } = bench();
  autosave.schedule("tier", op("1m"), 5);
  autosave.dispose();
  await settle();
  assert.equal(writes.length, 1, "closing the page does not lose the last click");
  autosave.schedule("fast", [{ op: "set", path: ["models", "m", "fast"], value: "on" }], 5);
  await settle();
  assert.equal(writes.length, 1, "a disposed writer ignores later changes");
});
