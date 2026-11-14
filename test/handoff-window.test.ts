import { test } from "node:test";
import assert from "node:assert/strict";

import { HandoffWindow } from "../src/session/handoff-window.ts";

test("the window starts at zero and ignores evidence it cannot use", () => {
  const window = new HandoffWindow();
  assert.equal(window.windowFor("m"), 0);
  assert.equal(window.windowFor("other"), 0);
  assert.equal(window.observe("m", 0), 0, "a zero gap proves nothing");
  assert.equal(window.observe("m", Number.NaN), 0, "a broken gap proves nothing");
  assert.equal(window.observe("", 10), 0, "a model id is required");
});

test("a learned window covers the observed gap with margin", () => {
  const window = new HandoffWindow();
  assert.equal(window.observe("m", 10), 15);
  assert.equal(window.windowFor("m"), 15);
  assert.equal(window.observe("m", 12), 18, "a larger gap grows the window");
  assert.equal(window.observe("m", 5), 18, "a smaller gap never shrinks it");
});

test("a gap only the ceiling covers adopts the ceiling, and one beyond it does not", () => {
  const window = new HandoffWindow();
  assert.equal(window.observe("m", 30), 45);
  assert.equal(window.observe("m", 40), 50, "40 x 1.5 is above the ceiling, but the ceiling covers 40");
  assert.equal(window.observe("m", 60), 50, "60 is beyond the ceiling, so the window stays");
  const fresh = new HandoffWindow();
  assert.equal(fresh.observe("m", 51), 0, "a gap the ceiling cannot cover is not adopted");
  assert.equal(fresh.windowFor("m"), 0);
});

test("models learn independently and the base and ceiling are configurable", () => {
  const window = new HandoffWindow({ ceilingMs: 20 });
  assert.equal(window.observe("m", 8), 12);
  assert.equal(window.windowFor("claude"), 0, "another model keeps the base");
  assert.equal(window.observe("m", 20), 20, "30 is above this policy's ceiling, so it takes the ceiling it does cover");

  const based = new HandoffWindow({ baseMs: 5 });
  assert.equal(based.windowFor("m"), 5);
  assert.equal(based.observe("m", 3), 5, "a gap below the base changes nothing");
});
