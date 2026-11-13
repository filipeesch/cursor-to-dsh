# Tasks

## 1. Confirm provider facts with a live run

- [ ] 1.1 Instrument the provider-turn usage handoff; verify by running the live script with a real key. The instrumentation is in place: `session/usage-ledger.ts` logs `usage key=… after=…ms handed=… content=…` per provider turn (enabled by `DSH_CURSOR_DEBUG=1`), and `scripts/live.ts` prints each call's report and when it arrived. The run itself needs an operator key.
- [x] 1.2 Settle whether `inputTokens` already includes cache tokens. The SDK derives `totalTokens` as the sum of all four buckets, so they are disjoint; the plugin reports them as stated and `test/units.test.ts` asserts that mapping.
- [ ] 1.3 Confirm the handoff usage grace (40 ms inside the 100 ms handoff budget) against measured arrival latency; verify the constant is a single named value (`HANDOFF_USAGE_GRACE_MS`) and the measurement justifies it. Blocked on the same live run as 1.1.

## 2. Structural split, behaviour unchanged

- [x] 2.1 Extract the debug logger into `src/debug.ts`; verify `npm run check` and `npm test` pass with no behaviour change.
- [x] 2.2 Split `prompt.ts` into `prompt/content.ts`, `prompt/render.ts` and `prompt/fingerprint.ts`; the token estimator existed only for the removed rescaling, so it is deleted rather than split. Verify the prompt unit tests pass.
- [x] 2.3 Replace the module-level session map with an injected `SessionRegistry` (`session/registry.ts`) owning slots, idle timers and close-all; verify session tests build their own registry and no test depends on shared global state.
- [x] 2.4 Extract increment planning into `session/increment.ts`; verify tests cover fresh, send and results plans.
- [x] 2.5 Extract tool synchronization into `session/tools.ts`; verify tests cover the tools key, custom tool mapping and the added-tools note.
- [x] 2.6 Extract the turn loop into `session/turn.ts`; verify `npm test` and `npm run check` pass and the adapter is a thin `LlmAdapter` implementation.
- [x] 2.7 Extract the catalog snapshot and the image cache out of `adapter.ts` into `cursor/catalog.ts` and the adapter's image cache; verify adapter tests pass and `adapter.ts` no longer owns caching policy.
- [x] 2.8 Update the layout table in `AGENTS.md`; verify every file in the table exists and every source file is listed.

## 3. Per-call usage attribution

- [x] 3.1 Add a per-turn usage slot to the session that is filled when the run stream yields a usage message; verify a unit test asserts the slot holds that turn's values.
- [x] 3.2 Implement the bounded handoff wait before a tool call is delivered, in `session/usage-ledger.ts` and `session/turn.ts`; verify a fake-agent test reports usage when it arrives inside the window and reports none when it arrives after it.
- [x] 3.3 Remove the cumulative-run usage path and the estimate-based rescaling from `usage.ts`; verify a fake-agent test where four tool turns plus a final answer report five independent usages and no call carries another turn's tokens.
- [x] 3.3b Attribute reports by turn structure, not timing: accept one only after the open call produced its own content, so a previous turn's late report is discarded. Verify the regression test where turn N's report arrives after call N+1 opened and call N+1 reports only its own.
- [x] 3.4 Map buckets to the host's disjoint contract per task 1.2, still omitting a combined total; verify unit tests cover the prompt-side sum and the cache-hit split.
- [x] 3.5 Update the existing usage assertions in `test/session.test.ts` that expect the scaled multi-call estimate; verify the suite passes with per-turn values.

## 4. Model configuration

- [x] 4.1 Add the `contextWindow: auto | <tokens>` option and make `resolveModel` report the effective tier; verify a test where an explicit window wins and `auto` follows the accepted tier after a step-down.
- [x] 4.2 Change the default requested context tier to the largest offered; verify a test asserts the largest tier is sent when nothing is configured, and that an explicit tier still wins.
- [x] 4.3 Persist the accepted tier per model in a state file and read it at startup, ignoring unknown entries; verify a test that round-trips the state file and reconstructs the store, showing the next process starts from the accepted tier.
- [x] 4.4 Add `fast: auto | on | off` (default off); verify tests for all three states plus a model that offers no such control.

## 5. Catalog off the request path

- [x] 5.1 Implement the catalog snapshot store with a synchronous read, TTL, retry backoff and single-flight refresh; verify unit tests show a stale snapshot is served without awaiting a fetch.
- [x] 5.2 Persist the catalog snapshot to disk and load it at startup; verify a test where a restarted catalog serves the persisted models without fetching.
- [x] 5.3 Route model resolution and call preparation through the snapshot only; verify a fake catalog that counts requests shows zero catalog requests on the request path.
- [x] 5.4 Keep the missing-credential failure for a cold start with no snapshot and no key; verify the existing `MISSING_CREDENTIAL` test still passes and no call hangs.

## 6. Stall watchdog

- [x] 6.1 Implement an inactivity monitor that resets on content deltas and is suspended before the handoff window opens; verify a test where a tool wait longer than the window does not trigger it and a silent stream does.
- [x] 6.2 Terminate a stalled call with `CURSOR_RUN_STALLED` plus a diagnostic naming the session key, model and elapsed time; verify tests assert the code, the recorded diagnostic and that the code is outside the host's default retry list.
- [x] 6.3 Add `stallTimeoutMs` with a finite default; verify a test with a short configured window triggers at that elapsed time.

## 7. English documentation

- [x] 7.1 Rewrite `README.md` in English, keeping installation, configuration, verification and limitations accurate; verify the file contains no CJK characters and the configuration table lists `fast`, `contextWindow` and `stallTimeoutMs`.
- [x] 7.2 Author `docs/images/flow.svg` with English labels and render `docs/images/flow.png` from it; verify the PNG exists, matches the implemented flow (first send carries the transcript, later sends only new content, stall path included) and contains no Chinese labels.
- [x] 7.3 Remove the CJK token-estimate test along with the estimator it tested; verify the suite passes and no tracked file contains CJK glyphs.
- [x] 7.4 Add the no-CJK check to the pre-publish script; verify it fails on a file containing a CJK glyph and passes on the cleaned tree.

## 8. Release verification

- [x] 8.1 Run `npm run check`, `npm test`, `npm run build` and `npm run check:public`; verify all four pass.
- [ ] 8.2 Run the live script end to end against a real account; verify every call that ends a provider turn reports its own usage, the reported throughput is in a plausible range, and no stall error is raised. Needs an operator key.
- [x] 8.3 Bump the package version to `0.2.0` and note the default context-tier change; verify the version in `package.json` and that `prepublishOnly` succeeds.
