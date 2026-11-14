# Proposal

## Why

A Cursor step is dominated by the provider (median 3.3 s per step measured before this change), but the plugin still adds a fixed **93 ms to every tool-call step**: a 50 ms blind collection window, then up to 40 ms waiting for a usage report. Live probes across six models (deepseek, gemini, haiku, sonnet, opus, grok) never saw a usage report arrive at a handoff — the report is run-scoped and lands at the run's end — so those 40 ms are spent on something that cannot happen. And in PTC sessions, where the provider sees a single `run_code` tool, a turn carries one tool call, so the 50 ms window buys nothing at all.

Two smaller costs sit next to it: the first Cursor call after a process start can pay ~3.8 s of SDK setup (measured: create 1.8–2.0 s plus first send 1.8–2.0 s) because warm-up only starts after a live catalog fetch, and there is no per-step timing record to verify any of this against production traffic. The previous latency change left the handoff constants explicitly "to be tuned from a live measurement" (archived task 1.3); that measurement now exists, and it covers how sibling tool calls actually arrive.

## What Changes

- **Adaptive handoff window**: replace the fixed 50 ms collection window and the 40 ms usage grace with a window that starts at **0 ms** and learns per model — raising toward a **50 ms ceiling** only when a sibling tool call is observed arriving after a handoff, and only when the raised window would actually cover the observed gap. No mode detection: in PTC no sibling ever arrives, so the window stays at 0 ms.
- **Usage at handoff**: keep using a report that has already arrived when tool calls are delivered; remove any dedicated wait for it. A call that ends without a report still reports nothing.
- **Warm-up at apply**: start the SDK warm-up when the plugin is applied, from the persisted catalog snapshot (or the fallback models), instead of waiting for a live catalog fetch to succeed.
- **Per-step telemetry**: a new configuration option (off by default) that writes one line per step with the plugin's own timings, the streamed volume, the handoff window in effect, observed splits, and the run's usage report when it arrives. Off the request path, never on by default.
- **Live check repaired**: `scripts/live.ts` references configuration fields that no longer exist and is not type-checked; fix it and print a frame timeline so the measurement behind this change is reproducible.
- **Small cleanups in the touched path**: an index cursor instead of `shift()` in the chunk queue, one transcript render and one fingerprint pass per call instead of two.

Not changing: the route id, model ids, the row id, the `DSH_CURSOR_*` variables, error codes outside the host's retry list, Cursor's tool policy, and the session/agent reuse that keeps the prompt cache warm.

## Capabilities

### New Capabilities

- `turn-telemetry`: what the plugin records per step when telemetry is enabled, where it writes, and the guarantee that it stays off the request path and off by default.

### Modified Capabilities

- `request-latency`: the requirement that tool calls of one provider turn reach the host together changes — the fixed 100 ms budget becomes an adaptive window starting at 0 ms with a learned ceiling, and the plugin warms the provider SDK at apply time rather than after a live catalog fetch.
- `usage-reporting`: the requirement that waiting for a per-turn report is bounded changes — the plugin no longer reserves any part of the delivery window for that report.

## Impact

- `src/session/turn.ts`, `src/session/session.ts`: the handoff path and the state that fed the fixed window.
- New modules for the window policy and the timing recorder (named in design), wired from `src/index.ts`; one new option in `src/config.ts`.
- `src/sdk.ts`, `src/index.ts`: warm-up triggered at apply from the persisted catalog.
- `src/reply.ts`, `src/prompt/render.ts`: queue cursor and single-pass cleanups.
- `scripts/live.ts` and the type-check configuration that covers it.
- Specs: `request-latency`, `usage-reporting`, new `turn-telemetry`; documentation: `README.md` (the 100 ms limitation), `AGENTS.md` (layout table).
- Tests: functional tests through `CursorAdapter.stream()` with the fake agent; no timing-based CI guard.
- No new runtime dependency; `@cursor/sdk` stays the only one.
