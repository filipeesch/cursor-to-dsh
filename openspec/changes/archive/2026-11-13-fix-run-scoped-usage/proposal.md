# Proposal

## Why

Measured against the live provider: a Cursor run emits **one** `usage` report, at its end, accumulated over every model call the run made. A probe with three model calls and a ~16K-token transcript returned a single report of 55,535 prompt tokens (~3x one call's context), and `run.wait()` returns the same object.

The plugin reports that report as if it were one call's usage. So the host's context pressure is N times the real context — a session showed **10.9M against a 1M window**, permanently 100%, which also makes compaction believe the conversation is far past its budget — and completion tokens are N times the real per-call output, which is why the speed pill showed **2060 tok/s**.

## What Changes

- **Normalize the run's report to one request**: every bucket of the report is divided by the number of model calls that run made, and the result is reported once, on the call where the report arrives (the run's last). A single-call run is unaffected and stays exact.
- **Count model calls per run**: the session tracks how many calls the current provider run has served, reset when a new run starts.
- **Document the consequence**: the host's session totals now represent the run's average request rather than the sum of every call, because the provider does not disclose per-call figures.

Not changing: disjoint buckets, no combined total, no character-based estimate, the bounded wait, the discard rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `usage-reporting`: usage is no longer presented as one call's billing. The requirement states that a run-scoped report is normalized by the run's call count before it reaches the host, and the no-estimates requirement now distinguishes that normalization from a heuristic estimate.

## Impact

- `src/usage.ts`: bucket mapping gains a divisor.
- `src/session/session.ts`, `src/session/turn.ts`: per-run call counter and the normalized report.
- `openspec/specs/usage-reporting/spec.md`: purpose line adjusted to the run-scoped reality.
- `README.md`: the limitation that says "usage is reported per provider turn" becomes the run-scoped explanation.
- Tests: a multi-call run reporting its average, a single-call run staying exact, and the bucketing divisor.
