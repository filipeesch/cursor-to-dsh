# Tasks

## 1. Adaptive handoff window

- [x] 1.1 Create the window policy as a small injected object keyed by model id: base 0 ms, ceiling 50 ms, grow to `ceil(gap * 1.5)` only when that value is within the ceiling, never shrink. Verify with unit tests covering the zero base, one growth, a gap beyond the ceiling (no growth), a second observation (no shrink) and two models staying independent.
- [x] 1.2 Wire the policy from `apply` through the adapter into the turn, the same way the registry and the tier store are passed, with no module-level state. Verify `npm run check` passes and a test shows two adapters built with different policies do not share a window.
- [x] 1.3 Replace the fixed 50 ms collection window in the delivery path with the policy and delete the 40 ms usage grace. Verify with the fake agent that one call is delivered without a fixed delay, two calls produced in the same tick are delivered in one reply, and no delivery waits for a report that never arrives.
- [x] 1.4 Record the learning signal: a call registered while a delivery for the same run is still open updates the policy for that model. Verify with a fake agent that a sibling registered after the delivery raises the window for that model only, and that the next turn of that model can hold delivery up to the learned value.
- [x] 1.5 Update the existing session tests that assumed the 50 ms window and the 40 ms grace. Verify `npm test` passes with no test relying on removed constants.

## 2. Late sibling guarantee

- [x] 2.1 Add a functional test for a sibling registered after its turn's delivery: the next call delivers it, the provider run continues with the result, the conversation is not resent and no new provider run starts. Verify the test asserts a single `agent.send` for the run and that the pending calls drain to zero.
- [x] 2.2 Verify the same test covers the final answer after the late sibling's result, so a split ends in a normal `stop` instead of a stall or a replay.

## 3. Warm-up at apply

- [x] 3.1 Trigger warm-up in `apply` once a credential resolves and a catalog snapshot (or the fallback model list) is available, using that model id, without waiting for a live catalog fetch. Verify with unit tests of `warmUpAtStart`: it warms with the snapshot's model id (or the first known model), and does nothing when disabled, without a credential or without a model.
- [x] 3.2 Keep the live-catalog trigger and make it idempotent with the apply trigger. Verify a unit test where two `prewarmCursor` calls create one agent, a test where a failed attempt releases the slot so the next trigger retries, and the disabled path of `warmUpAtStart`.

## 4. Per-step telemetry

- [x] 4.1 Add the `timing` configuration option (default off) to the schema and to the resolved settings readers. Verify config tests assert the default is off and that an explicit value enables it.
- [x] 4.2 Implement the record accumulator and its sink: one JSON line per completed step written to the plugin state directory, best effort, never throwing into the call path. Verify unit tests for the record shape and for an unwritable directory leaving the call unaffected.
- [x] 4.3 Mark the stages in the turn and finalize the record on delivery or finish: session created or reused, pre-send time, time to first content, delivery or end time, window in effect, tool calls delivered, conversation bytes sent, streamed text and reasoning chunks. Verify a fake-agent test asserting the fields for a tool step and for an answer step.
- [x] 4.4 Attach the SDK's per-update callback only when telemetry is enabled and fold its facts into the record (step duration, the run's usage report when it arrives, a sibling observed after a delivery). Verify a test that no listener is attached while telemetry is off, and that a summed chunk count and the provider report appear in the record when it is on.
- [x] 4.5 Verify the disabled path is untouched: with telemetry off, no file is written and no listener is passed to `send`.

## 5. Cleanups on the touched path

- [x] 5.1 Replace the chunk queue's `shift()` with a read cursor. Verify the queue tests pass and that draining a large burst still yields every chunk in order.
- [x] 5.2 Render the transcript once when a session is created and reuse that string for the debug line. Verify the existing session tests pass and the debug path no longer renders a second time.
- [x] 5.3 Compute the message fingerprints in one pass per call and reuse them for the increment check and the seen snapshot. Verify the existing increment tests pass and a new test asserts the seen snapshot matches the request's own fingerprints.

## 6. Live check and type coverage

- [x] 6.1 Rewrite `scripts/live.ts` against the current adapter dependencies and print a per-call frame timeline (frames, per-update events, delivery time). Verify it runs against a real key and prints the timeline without touching the host.
- [x] 6.2 Include `scripts` in a type-check project so the live check cannot drift again. Verify `npm run check` covers it and fails on a deliberately stale field.

## 7. Documentation and release

- [x] 7.1 Update the README limitation that describes the 100 ms delivery budget and the usage wait, and add the new modules and the telemetry option to the AGENTS.md layout table. Verify no stale constants remain and `npm run check:public` passes.
- [x] 7.2 Run the full gate: `npm test`, `npm run check`, `npm run build`, `npm run check:public`. Verify all four succeed.
