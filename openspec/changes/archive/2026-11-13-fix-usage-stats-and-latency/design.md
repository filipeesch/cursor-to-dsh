# Design

## Context

See `proposal.md` - Why for the measured problem. The constraints that shape the approach:

- **Host contract**: DSH calls `LlmAdapter.stream()` once per step and reads usage from a single `usage` chunk before the terminal `finish`. Its `tokenUsage` and `contextPressure` projections treat one chunk as one request: `inputTokens` is *uncached* input, cache buckets are separate, and a reported `totalTokens` that disagrees with the buckets is discarded. `decodeMs` is measured from the first content delta to the assembled message, so `outputTokens` must be that call's output only.
- **Provider reality**: one Cursor "run" spans many model turns; a turn ends with a tool call or a final answer. Each turn is one DSH step. Usage is available per turn in the run stream (a `usage` message) and cumulatively at run end.
- **Current structure**: `session.ts` (500 lines) owns the session registry, increment planning, tool synchronization, run lifecycle, usage selection and the turn loop. `adapter.ts` owns catalog caching, an image cache and streaming. `prompt.ts` owns rendering, fingerprinting, token estimation and system-prompt diffing. `usage.ts` owns bucket mapping, overhead calibration and estimate-based rescaling.
- **Seams we must not move**: the route id `cursor`, model ids, the `llm-cursor` row id, the `DSH_CURSOR_*` variables, the `Config` namespace, and error codes outside DSH's retry list.

## Goals / Non-Goals

**Goals:**

- One usage report per model call, matching the host's one-chunk-per-request contract.
- One place that decides model parameters, so "what we send" and "what we advertise" cannot disagree.
- A request path with no blocking I/O before the first delta.
- A stalled run becomes a first-class, diagnostic outcome.
- Module boundaries where each file has one reason to change, wired by constructor injection instead of module-level singletons.

**Non-Goals:**

- Changing Cursor's tool policy, retry behaviour or error-code classes.
- Estimating usage when the provider reports none.
- Working around provider latency itself (model speed is Cursor's).
- Migrating persisted sessions or replaying history differently.

## Decisions

### 1. Capture per-turn usage from the run stream, and attribute it by turn structure

`CursorSession` gains a per-turn slot filled whenever the run stream yields a `usage` message. A report is accepted only while a call is open **and that call has already produced content of its own turn**: a turn's report never precedes its own content, so an early report belongs to a turn that already closed. Timing alone is not enough — a report for turn N can land after the call for turn N+1 has opened.

A tool handoff may spend at most the remaining handoff budget (100 ms in total: 50 ms to collect sibling calls, at most 40 ms more) trying to catch the report, so the host's tools are never held back for the sake of numbers. The final answer waits nothing: the run has ended, so any report has already been delivered.

```
provider turn N:   assistant text ──> tool call ──> usage
call N:            deltas ...        handoff      report usage(N)  [wait <= 200ms]
```

Why not the run's cumulative usage: it is the sum over all turns, so dividing it by one turn's decode window produces the measured 15x-inflated throughput, and it reports nothing for the 97% of calls that end in a tool call.

Why not "no wait, attribute on the next call": the deltas would land one call late, so the throughput meter would read zero for most calls and spike for the next one.

Why not a provider turn id: the SDK's usage message carries the agent id and run id, not a turn ordinal, so the plugin derives the turn boundary from content it has seen rather than from a field that does not exist.

Why not estimate output tokens from streamed characters: it would put a fabricated number into a billing-shaped field, and the host has no way to tell it apart from a provider figure.

Alternatives considered: reading `agent.getUsage()` per turn (extra round trip, same data, later); splitting the cumulative total proportionally across turns (invents a distribution).

**Verification before finalizing**: a live script run (`scripts/live.ts`) confirms whether the `usage` message for a turn arrives before or after the tool handoff, and whether 200 ms is enough. If it consistently arrives after the handoff, the wait absorbs it; if it arrives much later, the fallback is to report no usage for that call rather than mis-attribute it.

### 2. Report buckets exactly as the provider states them

The provider states `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` and computes `totalTokens` as their sum, which makes them disjoint. The plugin currently subtracts cache from `inputTokens` and rescales everything for multi-turn runs. Both stop. `totalTokens` keeps being omitted.

This is deliberately isolated: the prompt-side sum is unchanged either way, so context pressure is unaffected by the bucket fix, and only the input/cache split (and therefore the cache-hit share) changes.

The character-based token estimator existed only to feed that rescaling, so it goes with it instead of becoming untested dead code. That also removes the plugin's only reason to keep CJK-specific counting logic.

Alternatives considered: keep the subtraction behind a flag (dead configuration for a bug); detect the convention per response (no signal to detect it with); keep the estimator for diagnostics (no consumer left).

### 3. One resolver owns model parameters and advertised metadata

A single resolver turns (catalog entry, configuration, remembered accepted tier) into both the request parameters and the advertised model info. `resolveModel` and `stream` read from that resolver, so the context window the host meters against is by construction the tier the provider will apply.

The resolver reports, in order of precedence: an explicitly configured window, the accepted tier remembered for that model, the configured tier, the largest offered tier.

### 4. Persist the accepted tier, not the catalog only

When the provider rejects a tier, the accepted one is written to a small JSON file under the host's state directory, keyed by model id. Unknown or stale entries are ignored so a provider catalog change cannot wedge the plugin.

Why persist: the rejection costs a full failed run (the slowest possible outcome), and today it is paid again on every process start.

### 5. Catalog becomes a snapshot store, never on the request path

A catalog store keeps an in-memory snapshot plus a disk snapshot and exposes a synchronous `current()`. The request path only ever reads `current()`. Refresh is a background task with a TTL, a retry backoff, and a single in-flight promise. A cold start with no snapshot and no credential fails with the existing missing-credential error instead of waiting.

Alternatives considered: keep the async lookup but cache harder (still a network wait on the 10-minute boundary); load the catalog only from the settings UI (unacceptable — a headless run would have no params).

### 6. Watchdog with a suspended window during tool execution

An inactivity monitor observes the run stream. It resets on any content delta and is **suspended before the handoff window opens**, not after it, because the plugin's own collection and usage wait are not provider silence and waiting for the host to execute a tool legitimately produces no content for minutes. A fired stall is cleared when the next call takes over the session. On expiry the call terminates with a dedicated code (`CURSOR_RUN_STALLED`, outside the host's retry list) and a diagnostic line carrying session key prefix, model, elapsed time and the last observed message type.

The window is configurable (`stallTimeoutMs`), defaulting to 120 s.

Alternatives considered: log only (leaves the host blocked); rely on the host's own timeouts (there are none for a model call).

### 7. Session state becomes an injected registry

The module-level `SESSIONS` map, its idle timers and `closeAllCursorSessions()` become a `SessionRegistry` instance created by the adapter and closed through the plugin's `ctx.effect`. Tests construct their own registry instead of relying on hidden global state.

Why: the current global map is the reason the turn module cannot be tested without cross-test interference, and it hides ownership of cleanup.

### 8. Module layout

```
src/
  index.ts                  plugin entry: config, key/cwd resolution, wiring
  config.ts                 Config schema + resolved options
  adapter.ts                LlmAdapter (thin): listModels / resolveModel / stream
  debug.ts                  DSH_CURSOR_DEBUG logger
  sdk.ts                    @cursor/sdk access, ripgrep, prewarm
  transcript.ts             request -> core transcript
  reply.ts                  StreamChunk output + chunk queue
  models.ts                 catalog -> model info, params, efforts
  usage.ts                  bucketing only
  cursor/
    catalog.ts              snapshot store (current/refresh/persist)
    context-tier.ts         tier selection, step-down, persisted acceptance
  session/
    session.ts              CursorSession: run lifecycle, pending calls, wake/wait
    registry.ts             SessionRegistry: slots, idle timers, close-all
    increment.ts            planIncrement -> Plan
    tools.ts                tools key, custom tool mapping, added-tools note
    turn.ts                 one DSH call end to end
    usage-ledger.ts         per-turn usage slot + bounded wait
    watchdog.ts             inactivity monitor
  prompt/
    content.ts              shared content helpers (text, tool arguments, images)
    render.ts               transcript rendering, tool-result shape, prompt diff
    fingerprint.ts          fingerprints and message identity
```

Dependencies point one way: `index -> adapter -> session/turn -> (session, increment, tools, usage-ledger, watchdog, models, usage, prompt, transcript)`. No module reaches back into `index` or `adapter`, and no module owns another's state.

Alternatives considered: keep `session.ts` and extract only usage (leaves the god module and the tests coupled); a single `core/` folder (no domain signal, and the tree above already reads as domains).

### 9. Documentation in English, with the diagram as a text source

`README.md` is rewritten in English. The sequence diagram is authored as an SVG source committed next to the rendered PNG so labels can be edited without an image editor, and rendered to `docs/images/flow.png`. The only remaining CJK is test data for the CJK token estimator, constructed from code points instead of literal characters so no Chinese text sits in a tracked file.

## Risks / Trade-offs

- **The per-turn `usage` message may arrive after the handoff in practice** → the 200 ms wait absorbs the common case; otherwise that call reports no usage. Mitigation: measure it with the live script before fixing the constant, and keep the wait a single named constant.
- **Spending handoff budget on usage** → a tool handoff may cost up to 90 ms instead of 50 ms when the provider is slow to report. Mitigation: the wait returns as soon as the report arrives, the final answer pays nothing, and the whole window stays inside the 100 ms delivery bound.
- **Largest context tier is rejected on some accounts** → one failed run per model per fresh state. Mitigation: persist the accepted tier, and step down to the next smaller offered tier until one is accepted (bounded by the tiers the model offers).
- **Larger context tier means larger billed prompts** → cost per request can rise even though request count does not. Mitigation: the tier is configurable back to `min`.
- **Fast mode changes billing** → default stays `off`, so nothing changes unless configured.
- **Bucket semantics change shifts previously displayed cache-hit numbers** → existing sessions keep their recorded values (projections are durable); only new calls differ. Mitigation: document the correction in the README.
- **Removing estimate-based rescaling removes a (wrong) plausible number for multi-turn calls** → those calls now report their real per-turn prompt size, which is smaller. Mitigation: this is the intended correction; the meter stops exceeding its own window.
- **Watchdog false positives** → suspended during tool waits and reset by any delta. Mitigation: configurable window and a diagnostic that names what the run was doing.
- **Watchdog could mask a genuinely slow first token on a huge transcript** → the window is inactivity, not total duration, and resets at the first delta; the prewarm and catalog work reduce the cold path.
- **Module split is a large diff** → behaviour-preserving moves are done in their own commits with tests green between each, and the public seam (`adapter.ts`) changes shape only at the end.
- **Disk cache of catalog and tiers can go stale** → bounded by TTL, ignored on parse failure, and never authoritative over a live catalog read.

## Migration Plan

1. Land the structural split with no behaviour change; tests green at every commit.
2. Land usage attribution and bucket mapping; verify with `scripts/live.ts` against a real Cursor account.
3. Land the catalog store, tier persistence, Fast mode, context-window override and watchdog, each behind its configuration default.
4. Update `README.md`, the diagram and `AGENTS.md` layout table.
5. Release as the next minor version (`0.2.0`): the default context tier is the one breaking change.

Rollback: the plugin is a profile dependency; reverting to `0.1.x` restores the previous behaviour. The persisted tier file is ignored by `0.1.x` and can be deleted safely.

## Open Questions

- Whether Cursor emits a turn's report before or after the host's tool result reaches the run. If it is always after, tool turns will keep reporting nothing (task 1.1 measures this); the attribution stays correct either way, but the benefit would then be limited to final answers.
- The exact values of the handoff usage grace (40 ms) and the default inactivity window (120 s), both to be tuned from that same live measurement.

Resolved during implementation: the SDK derives `totalTokens` as `inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`, so the buckets are disjoint and the plugin reports them as stated.
