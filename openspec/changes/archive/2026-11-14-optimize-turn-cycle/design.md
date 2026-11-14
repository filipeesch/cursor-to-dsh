# Design

## Context

See `proposal.md` - Why. The constraints that shape the approach:

- **Host contract**: DSH calls `LlmAdapter.stream()` once per step and treats the whole reply as one assistant message. It executes that reply's `tool-call` blocks as a batch (`maxParallelToolCalls`) and only then calls `stream()` again. A tool call that misses its reply has no other channel: it can only be delivered by the next call.
- **Provider reality** (measured with live probes on deepseek-v41-flash, gemini-3-flash, claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, grok-4.7):
  - Sibling tool calls arrive in one burst in the same tick (deepseek, grok), 17.5-46 ms apart (deepseek/gemini), 30-120 ms apart (gemini), or 3-5 s apart (sonnet, opus).
  - The `usage` report is run-scoped and arrives only at the run's end; it was never present at a tool-call delivery in any probe.
  - A split (a sibling delivered on the next call) costs one extra provider turn: the same two-tool task measured 13,402 prompt tokens when batched and 20,677 when split (+54%).
  - The first agent of a process pays create 1.8-2.0 s plus a first send of 1.8-2.0 s; afterwards create and send are 0.6-7 ms.
  - The plugin's own per-step CPU is ~0.4 ms (transcript read, fingerprints, tool key), the continuation after a tool result is ~0.8 ms, and stream fan-out is ~1.8 us per chunk.
- **Current code**: `src/session/turn.ts` holds the delivery path — a fixed 50 ms collection window from the last registration plus a 40 ms wait for a usage report, both before `reply.toolCalls(...)`. `CursorSession` keeps the pending calls and the ledger; `SessionRegistry` keeps live sessions; there is no per-step timing record.
- **Project rules**: dependencies point one way (`index -> adapter -> turn`), collaborators are injected rather than imported as singletons, sources stay type-strippable, the route and variable names stay stable, no new runtime dependency.

## Goals / Non-Goals

**Goals:**

- Remove the plugin's fixed delay from the tool-call path without losing the burst batching that keeps parallel calls in one reply.
- Make the window self-correcting per model, so a too-small window costs at most one split per model per process.
- Keep warm-up off the network path: a credential plus a persisted snapshot is enough.
- Make one step's cost observable (stage timings, volume, window, usage when present) without touching the request path.
- Repair the measurement harness so the numbers in this change can be reproduced.

**Non-Goals:**

- Changing the host, the SDK version, or the provider protocol.
- Making per-model-call usage figures appear: the provider reports once per run, and `agent.getUsage()` answered `feature_unavailable` on the account used for the probes.
- A timing-based CI guard (decided: functional tests only).
- Restructuring `runTurn` (deferred to a later change).
- Persisting the learned window across processes.

## Decisions

### 1. Adaptive collection window: base 0 ms, learned per model, ceiling 50 ms

The fixed window and the usage wait are replaced by one value object that answers "how long may this delivery hold?" for a model id. It starts at 0, and grows only on evidence: when a tool call is registered while a delivery for the same run is still open, the observed gap is recorded and the window becomes `ceil(gap * 1.5)` when that fits the ceiling, the ceiling itself when only the ceiling covers the gap (34-50 ms), and it stays put when the gap is beyond the ceiling — because a window that cannot cover the gap would charge every step for a split it cannot prevent. The window never shrinks within a process.

In PTC sessions the provider sees a single `run_code` tool, so a turn carries one call and the window never grows: the base stays at 0 ms without any mode detection.

Why not a fixed 50 ms: it is paid by every tool step, including the single-call turns where it buys nothing (measured 93 ms per step, of which 50 ms was the window).

Why not a 100 ms learned ceiling: paying 100 ms per step costs more than the split it would avoid, and no observed gap outside the same tick (46-120 ms) fits with room to spare.

Why not gate on the SDK's `tool-requests-listed` count: it is not a batch size. Measured across models it arrives as the full batch up front (deepseek), as an increment (gemini: 1 then 2), and as a decrement (sonnet/opus/grok: 2 then 1), while the second call may arrive seconds later.

Why not detect PTC and branch: the host passes no tool-mode flag in `GenerateOptions`; the only signal would be "one tool named `run_code`", which couples the window to a host name. The zero base already yields 0 ms in PTC.

### 2. No dedicated wait for a usage report

The ledger still accepts a report that arrived before the call ends, so a final-answer step keeps reporting what the provider sent. The delivery no longer reserves time for it: the report is run-scoped and does not exist yet when tool calls are handed off, which the probes confirmed on six models.

Why not keep a small grace: any grace is paid on every tool step and, per the measurement, can never be satisfied at that point.

Why not report a late report on the next call: the host attributes usage to the call that carries it, and the spec forbids carrying a closed turn's report forward.

### 3. A sibling that misses its delivery is carried by the next call

This already works and the change makes it a guarantee instead of an accident: the provider run stays open, the sibling becomes the next call's tool-call delivery, and the conversation is not resent. The measured cost (one extra provider turn) is exactly why the window exists; the two mechanisms are complementary.

Alternatives considered: dropping the late call (loses model output), cancelling and replaying the run (a full conversation resend for a tool call), or holding the delivery open until the run is idle (waits seconds on sonnet/opus).

### 4. Warm-up at apply, from the persisted snapshot

`prewarmCursor` is already idempotent (`warming ??=`). It gains a second trigger in `apply`: once the persisted catalog snapshot is loaded and a credential resolves, warm with that snapshot's first model id (the fallback list's first id when the snapshot is empty). The live-catalog trigger stays and becomes a no-op when warm-up already ran. `DSH_CURSOR_PREWARM=0` keeps opting out.

Why not wait for the live catalog: a slow or failed fetch would put the whole setup back on the first user step.
Why not warm from `prepareCall`: that hook receives only provider and model, so it cannot supply the working directory or the custom tools.
Why not reuse the warmed agent as a spare for the first session: it carries a throwaway conversation, and the saving is one create per task at the cost of a pool with lifecycle rules.

### 5. Telemetry as an injected recorder, enabled by configuration

A new module owns the record: an accumulator per step (stage marks, counters) and a sink that buffers records and appends them to the plugin state directory on the next tick, next to `stall.log`, so the host's terminal chunk never waits on the filesystem. The turn marks the stages; the adapter owns the sink; both are injected, so tests build their own. A new configuration option (`timing`, default off) decides whether the sink is active.

The streamed token volume and the step duration come from the SDK's per-update callback, so `onDelta` is attached on `send` **only when telemetry is enabled**; otherwise nothing is attached and the request path is exactly as today. The callback is routed to the open call's recorder through a sink the turn points at that call, so no counter has to be reset in a particular order. The record keeps the provider's `token-delta` volume and `step-completed` duration as reported facts, and counts the text and reasoning chunks the call delivered from the run stream; it does not turn either into billed tokens.

Why not always-on: a JSON line per step for every user, and an `onDelta` listener that costs per update.
Why not an environment variable: the operator asked for a configuration option, and the plugin already exposes options through its row.
Why not write into the host's debug stream: stderr is not durable and is off by default anyway.

### 6. Window state lives with the plugin wiring, keyed by model

The window policy is created in `apply` and injected into the adapter, which passes it to the turn alongside the registry and the tier store. It is keyed by model id and lives in memory; it is not a module singleton and not session state, because the learning belongs to the model, not to a session that may be dropped at any time.

### 7. Cleanups on the touched path

- `ChunkQueue` gains a read cursor instead of `shift()` (measured: 20,000 chunks cost 150 ms with `shift()`, and the cost grows quadratically).
- The fresh-session path renders the transcript once; the debug line reuses that string instead of rendering it again.
- Fingerprints are computed in one pass per call and reused for the increment check and the `seen` snapshot.

Both are ~0.5 ms per step today and are included because the path is being touched, not because they move the needle.

### 8. The live check becomes maintainable

`scripts/live.ts` is rewritten against the current `AdapterDeps` and prints a frame timeline (frames, `onDelta` updates, delivery time) so the measurements in this change can be reproduced against a real account. It is included in a type-check project so it cannot drift again.

## Risks / Trade-offs

- **One split per model per process in non-PTC** (the learning sample) costs one extra provider turn, measured at +54% prompt tokens for a two-tool task -> Mitigation: only the first occurrence; telemetry records it so the frequency is visible.
- **A model that emits siblings with widely varying gaps** keeps paying a learned window that only covers the small ones -> Mitigation: the ceiling bounds the cost at 50 ms; a gap wider than the ceiling leaves the behavior as today.
- **Learning from a wrong signal** could raise the window for a model that never needed it -> Mitigation: only grow while a delivery is open and a handed call exists; never grow past the gap that was observed; never shrink.
- **A per-turn usage report, if a provider ever emits one at delivery time**, would be lost on tool turns -> Mitigation: reports that arrive before the delivery still count, and telemetry shows whether a report ever lands there.
- **Warm-up creates a throwaway agent per process** even when Cursor is never used -> Mitigation: only with a credential and a known model; `DSH_CURSOR_PREWARM=0` opts out.
- **Telemetry's `onDelta` duplicates per-update dispatch** when enabled -> Mitigation: attached only when enabled; the measured cost of the plugin's own stream path is 1.8 us per chunk.
- **The learned window does not survive a restart** -> Mitigation: accepted; one split per model per process is cheaper than persisting a timing heuristic.

## Migration Plan

1. Land the adaptive window and the removal of the usage wait, with functional tests for burst batching, the solo call, and the late sibling. Spec deltas for `request-latency` and `usage-reporting`.
2. Land warm-up at apply (spec delta already in `request-latency`).
3. Land the telemetry option, the recorder and its spec, then the live-script repair and type-check coverage.
4. Land the cleanups.
5. Update `README.md` and `AGENTS.md`. Release with the next version; rollback restores the previous build. No persisted state changes shape — the window is in memory and the telemetry file appears only when enabled.

## Open Questions

- Whether the SDK will ever document `tool-requests-listed` as a batch total. Deferrable: no behavior in this change depends on it.
