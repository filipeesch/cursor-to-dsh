# Design

## Context

See `proposal.md` - Why. The measurement that shapes this: one `usage` message per run, emitted at the run's end, whose prompt side grows with the number of calls (three calls, ~16K-token transcript, 55,535 prompt tokens), and `run.wait().usage` returning the identical object. Cursor's "turn" is the host's turn, not one model call.

The host, by contrast, needs one request per usage chunk: prompt-side buckets are its context pressure (and therefore its compaction trigger), and completion tokens are divided by that call's decode window for the speed pill.

## Goals / Non-Goals

**Goals:**

- A context reading that tracks the real conversation size instead of the run's accumulated traffic.
- A speed reading in the right order of magnitude.
- No fabricated numbers: every reported figure comes from a provider report divided by an observed count.

**Non-Goals:**

- Recovering per-call usage the provider does not expose.
- Making the host show a run total; it has no field for one.

## Decisions

### 1. Divide by the observed call count, not by an estimate

The session counts the model calls the current run has served. When the report arrives, every bucket is divided by that count and rounded. Both operands are facts: the provider's report and the plugin's own call count.

Why not a character-based estimate of the transcript: it invents the number the host then trusts for compaction, and it was removed for that reason.
Why not report the raw run total: it makes the meter permanently 100% and triggers compaction on a conversation that is not full — the defect this change fixes.
Why not spread across calls: the report only exists when the run ends, so earlier calls cannot be retroactively corrected.

### 2. Report once, on the call that receives the report

The call that ends the run is the one holding the report, and it is the only call whose usage chunk the host will read for that run. The earlier calls report nothing, which the host already tolerates (a step without usage simply contributes no sample).

### 3. Reset the count when a run starts

`startRun` marks a new provider run; the counter resets there. Continuing a run with tool results does not reset it, because those calls belong to the same run and the same accumulated report.

### 4. Accept the totals trade-off explicitly

Session totals become "average request per run", not the sum of every call. That is a real undercount of billed prompt volume, and the alternative is a context meter that is wrong by an order of magnitude and a compaction loop. The README states the trade-off.

## Risks / Trade-offs

- **Session totals under-report billed volume by roughly the run's call count** -> documented; the meter and compaction, which are actionable, become correct.
- **The average lags the growing context inside a run** -> the run's calls see a context between its first and last size; using the average is closer than either endpoint for a long run.
- **A run that serves many calls and then grows a lot** -> the average under-reports the final request; acceptable, and it errs toward not compacting early.
- **A run whose report arrives after the call closed** -> still discarded by the existing rules; that run reports nothing.
- **The first run of a session reports nothing until it ends** -> unchanged from the previous behaviour.

## Migration Plan

1. Land the counter and the normalized report behind the existing defaults.
2. Update the spec, README and tests.
3. Release as `0.3.1`. Rollback: revert the version; no persisted state changes shape.

## Open Questions

None that change the build.
