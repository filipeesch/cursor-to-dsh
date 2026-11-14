# AGENTS.md

DeepSeek Harness (DSH) plugin that registers Cursor as the `cursor` LLM provider route. DSH owns the agent loop, tools and permissions; Cursor is only the model. The session core was ported from the author's Cursor provider for pi (cursor-to-pi) and has since been split into modules. The plugin also ships a browser half that contributes its own configuration page in Settings -> Plugins.

## Layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | Plugin entry (`name`, `inject`, `Config`, `apply`): wiring, state files, catalog and published-capacity snapshots, catalog route, adapter registration |
| `src/config.ts` | Config schema (every editable field volatile) and `resolveSettings`, which returns readers over the live configuration |
| `src/constants.ts` | Provider id, package name, conventional credential reference, catalog route path, default row id |
| `src/documented-capacities.ts` | Capacities the provider documents but never publishes, keyed by catalog id, with the source each came from |
| `src/model-catalog.ts` | Catalog shapes, model identity, display names and the fallback model list |
| `src/model-tiers.ts` | Context tiers, tier selection and the rejected-tier step-down |
| `src/model-params.ts` | Catalog parameters -> the params one request carries, and reasoning efforts |
| `src/policy/types.ts` | Policy types and the documented default policy |
| `src/policy/model-config.ts` | Per-model entry merge, enablement and the effective per-model modes |
| `src/policy/context.ts` | Advertised context window precedence and its provenance |
| `src/policy/source.ts` | Validates live configuration into a policy; `ModelPolicySource` |
| `src/credentials.ts` | One credential resolver: host credentials, then the launch environment |
| `src/adapter.ts` | `CursorAdapter extends LlmAdapter`: `stream`, `listModels`, `resolveModel`, image cache |
| `src/catalog-payload.ts` | The catalog document the configuration page reads |
| `src/route.ts` | The authenticated catalog route and its payload |
| `src/transcript.ts` | DSH `GenerateOptions` -> core transcript (`user` / `developer` / `assistant` / `toolResult`) |
| `src/reply.ts` | DSH `StreamChunk` output, the mirrored assistant message and the terminal error codes |
| `src/usage.ts` | Cursor usage -> DSH disjoint buckets (no combined total) |
| `src/sdk.ts` | Cursor SDK access (agent, catalog, ripgrep path, prewarm) |
| `src/debug.ts` | `DSH_CURSOR_DEBUG` logger |
| `src/diagnostics.ts` | Stall trace appended to the state dir |
| `src/cursor/catalog.ts` | Model catalog as a snapshot the request path reads synchronously, refreshed out of band |
| `src/cursor/known-context.ts` | Published model capacities (models.dev) as a gzip-cached snapshot with a 24-hour window |
| `src/cursor/context-tier.ts` | The context tier Cursor accepted, per model |
| `src/cursor/state.ts` | State directory resolution and best-effort JSON/gzip persistence |
| `src/session/session.ts` | One Cursor agent per host session: run lifecycle, pending tool calls, usage ledger, watchdog |
| `src/session/registry.ts` | Live sessions by key, session key derivation, close-all |
| `src/session/increment.ts` | How the host's new messages map onto the live session |
| `src/session/tools.ts` | Host tools as Cursor custom (MCP) tools, tool-set key, added-tools note |
| `src/session/turn.ts` | One host model call end to end |
| `src/session/usage-ledger.ts` | The provider's report for the open call, and the bounded wait for it |
| `src/session/watchdog.ts` | Inactivity monitor for one provider run |
| `src/prompt/content.ts` | Shared content helpers (text, tool arguments, images) |
| `src/prompt/render.ts` | Transcript rendering, tool results, system-prompt diffing |
| `src/prompt/fingerprint.ts` | Message identity and hashing |
| `src/client/index.ts` | Browser half entry: registers the row's Configure page, fetches the catalog, stores the API key |
| `src/client/page.ts` | The stateful page: optimistic values, debounced writes, key state |
| `src/client/views.ts` | Hook-free presentational components |
| `src/client/derive.ts` | Pure view logic: rows, path operations, formatting |
| `src/client/controller.ts` | Observable store for the catalog and the key state |
| `src/client/autosave.ts` | Debounced per-field configuration writes, with failure reporting and a flush on dispose |
| `src/client/styles.ts` | The page's scoped stylesheet, injected once |
| `scripts/build-client.mjs` | esbuild build of `src/client` into the module-loader factory bundle |
| `scripts/smoke-client.mjs` | Loads the built bundle under a stub module loader and checks the row page registers |
| `scripts/live.ts` | Live check against real Cursor, without the host |
| `scripts/check-public.mjs` | Release guard for tracked text files |
| `cordis.patch.yml` | Bundle layer that inserts the `llm-cursor` row |
| `docs/images/flow.svg` | Sequence diagram source; `flow.png` is rendered from it |

## Commands

```bash
npm install
npm test         # unit tests with the fake Cursor agent, including the browser half's pure logic
npm run check    # tsc over the host and tests, then tsc over the browser half without node types
npm run build    # lib/ for the host plus lib/client.js for the browser (wipes lib/ first)
npm run check:public  # before any push to GitHub
```

Live check (real Cursor, no host): `CURSOR_API_KEY=... node --experimental-strip-types scripts/live.ts`. It prints each call's usage report and when it arrived, which is the measurement the per-call attribution depends on.

Render the diagram after editing the SVG: `rsvg-convert -w 1400 -h 980 docs/images/flow.svg -o docs/images/flow.png`.

## Rules

- Use the host's official seam (`ctx.llm.registerAdapter`); never wrap or patch host internals.
- Cursor's built-in tools stay off. Host tools are Cursor custom (MCP) tools whose `execute` waits for the host's result.
- Host packages (`@deepseek-ai/cordis`, `dsh-llm`, `dsh-credentials`, `dsh-launch-environment`, `schemastery`) are `peerDependencies` + `devDependencies`, never `dependencies`: the host supplies the shared instances.
- Keep the route id `cursor`, model ids, the `llm-cursor` row id and the `DSH_CURSOR_*` variables stable; user patches depend on them.
- Error codes stay outside the host's default retry list; a half-finished Cursor run must not be replayed. A stalled run has its own code (`CURSOR_RUN_STALLED`).
- Usage buckets are disjoint and `totalTokens` is omitted; the host discards a total that disagrees with the buckets. Report the provider's per-turn values only, never an estimate.
- Never block a call on the model catalog or on the published-capacity fetch: both are snapshots the request path reads, and refresh happens out of band.
- The Cursor SDK is pinned for the catalog metadata the plugin reads (`parameters`, `variants`); bumping it is a release decision, not a drive-by.
- A model's context window is the tier in effect, then a capacity published upstream, then a manual per-model value, then the capacity the provider documents in `src/documented-capacities.ts`, then the documented default. The published and documented values are declared capacities, never measured ones. Max Mode is legacy (Cursor removed it for usage-based pricing): never send its flag and never filter tiers by it.
- The policy is read per decision (`settings.readPolicy()`), never captured at `apply` time, so a save applies without remounting the plugin. Every field the page edits is volatile; ordinary fields are invisible to settings.
- The shipped modules under `src/policy`, `src/model-tiers.ts`, `src/model-catalog.ts`, `src/catalog-payload.ts`, `src/documented-capacities.ts` and `src/constants.ts` are imported by both halves: keep them dependency-free (no node builtins, no SDK).
- The catalog route is the plugin's only HTTP surface. It applies `connection.requestRejection` before answering, answers read-only JSON, and carries no credential material; without a web carrier it is never registered.
- The browser half is built by esbuild into one module-loader factory; React and the UI primitives stay external. `src/client/**` must not import node builtins, and its logic stays hook-free where it can be tested directly.
- Dependencies point one way: `index -> adapter -> session/turn -> (session, increment, tools, usage-ledger, watchdog, model-params, model-tiers, usage, prompt, transcript)`. Pass collaborators in; do not add module-level singletons.
- New behavior gets a test through `CursorAdapter.stream()` in `test/session.test.ts` or a unit test.
- Source must stay type-strippable (no enums, no parameter properties); `lib/` is built by `tsc` and esbuild, not committed.
- Documentation, code and comments are in English; no Chinese text in tracked files (`npm run check:public` enforces it).
- Do not commit secrets, internal links or local absolute paths; `npm run check:public` enforces the common cases.
