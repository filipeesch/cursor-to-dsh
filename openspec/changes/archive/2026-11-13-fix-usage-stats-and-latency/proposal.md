# Proposal

## Why

Cursor reports token usage once per run, as a cumulative total, and only when the run ends. DSH measures usage per step, and a Cursor run spans many steps (median 11, up to 844). The plugin therefore attributes a whole run's tokens to its last step: measured across 27 sessions and 7,580 steps, only 3.1% of steps report any usage, and the ones that do show a median of 2,406 tokens/second (maximum 373,319) against a real rate near 157. The remaining buckets are no better: multi-call runs rescale prompt tokens from a character-count estimate, so 66 of 233 samples claim a prompt larger than the context window they are measured against.

Latency is mostly Cursor's (median 3.3s per step, p90 16.6s), but the plugin adds avoidable cost to the request path and offers no way to tell a slow answer from a dead one: a model-catalog lookup can block a step before its first token, the non-priority Fast mode is forced off, the smallest context tier is requested, and a stalled run produces no diagnostic at all (observed stalls of 16 and 17 minutes).

## What Changes

- **Per-turn usage**: consume the Cursor SDK's per-turn `usage` stream message and report it for the step that just finished, instead of the run's cumulative total at the end. When a step carries no per-turn usage, report nothing rather than an estimate.
- **Disjoint buckets as reported**: stop subtracting (or rescaling) cache tokens from `inputTokens`, so `input`, `cacheRead`, `cacheWrite` and the cache-hit share reflect what the provider billed. Context pressure is unchanged, since it always summed the buckets.
- **Remove the estimate-based rescaling** of prompt buckets for multi-call runs.
- **Effective context window**: report the tier Cursor actually accepted, including after an automatic step-down, with a new `contextWindow: auto | <tokens>` option to override what DSH is told.
- **Higher default context tier**: request the largest tier the model offers instead of the smallest, so Cursor does not compact internally. The tier that worked is persisted so a rejection is paid once per model, not once per process.
- **Configurable Fast mode**: new `fast: auto | on | off` option, default `off` (today's behavior).
- **Model catalog off the request path**: serve the last known catalog synchronously and refresh it in the background, with a disk cache, so no step waits on network before its first token.
- **Stall watchdog**: bounded inactivity with a structured diagnostic and a clear terminal error instead of silence.
- **Structural split (no behavior change)**: separate session registry, increment planning, tool synchronization and the turn loop; extract catalog and image caching from the adapter; split prompt rendering, fingerprinting and token estimation.
- **English documentation**: translate `README.md` and regenerate `docs/images/flow.png` with English labels, leaving no Chinese text in tracked files.

Not changing: the default reasoning effort stays `high`; Cursor's built-in tools stay disabled; error codes stay outside DSH's retry list; the `cursor` route id, model ids, `llm-cursor` row id and `DSH_CURSOR_*` variables stay stable; no session data is migrated.

**BREAKING**: the default context tier moves from the smallest offered to the largest offered. Accounts that cannot use the largest tier will see one rejected run per model before the plugin steps down (and then persists the working tier).

## Capabilities

### New Capabilities

- `usage-reporting`: how the plugin maps Cursor token usage and context pressure into the DSH per-step contract, including what it reports when the provider reports nothing.
- `model-configuration`: how model parameters (context tier, reported context window, Fast mode, reasoning effort) are resolved from configuration and from what the provider accepted.
- `request-latency`: what the plugin may block on before a step's first token, and how it distinguishes a slow run from a stalled one.

### Modified Capabilities

None. `openspec/specs/` is empty at this change's base commit.

## Impact

- `src/usage.ts`, `src/session.ts`, `src/adapter.ts`, `src/models.ts`, `src/sdk.ts`, `src/index.ts`, `src/prompt.ts`: usage attribution, configuration, catalog and watchdog.
- New modules from the structural split (catalog store, session registry, increment planner, tool sync, turn runner, prompt renderer/fingerprint/tokens) and their unit tests.
- `cordis.patch.yml` and the `Config` schema: new `fast` and `contextWindow` options.
- `README.md`, `docs/images/flow.png`, `AGENTS.md`: English documentation and the layout table after the split.
- `test/session.test.ts`, `test/units.test.ts`: the fake Cursor agent gains per-turn usage messages; new tests for catalog, watchdog and configuration.
- Consumers of the reported numbers: DSH's activity pill (tokens/second), usage pill (cache hit) and context meter. Their values change, and become consistent with the provider.
- No new runtime dependency. `@cursor/sdk` stays the only dependency.
