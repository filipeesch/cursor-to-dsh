# Design

## Context

See proposal.md for motivation. The state that shapes the approach:

- The plugin is a single Node package (`src/`) registering the `cursor` route through `ctx.llm.registerAdapter`. Its configuration is a Schemastery `Config` resolved once in `apply()` into a frozen `ModelPolicy` handed to `CursorAdapter`.
- The product's settings service projects **only volatile Config fields**; ordinary fields are excluded from every settings surface. Today only `apiKeyEnv` is volatile, which is why nothing else is editable in the product.
- The Models settings page renders curated fields only for the `llm-deepseek` and `llm-pi-ai` namespaces; every other namespace gets a dead card. A plugin cannot add curated fields to that page without a host change.
- The Plugins settings page declares `plugins.row.config` (keyed `<package>#<row id>`), which gives a row a **Configure** control and hands the registrant `form.state` (value, base, user, revision, writable) and `form.mutate(ops, revision)` — the same host config form the first-party plugins use. The row's page only exists while an entry names it.
- A plugin may ship a browser half: `dsh.client` in `package.json` plus a built `./client` factory bundle. `react`, `cordis`, `zod`, the client store, the slots service and the UI primitives are shared platform modules; the bundle is one flat CommonJS factory that registers itself with `window.__ModuleLoader__.load`.
- The live catalog (`Cursor.models.list`) publishes `parameters[].values[].displayName` and `variants[].isMaxMode` / `isDefault`, 26 models at the time of writing, 11 of them without any context tier. `llm.discoverModels` returns only `id`, `name`, `contextWindow`, `maxTokens` and `inputModalities`, so it cannot carry that shape to a UI.
- `https://models.dev/api.json` is a public catalog (~6 MB, ~9000 models across ~236 providers) with `limit.context` per model. 22 of the 26 Cursor ids match it.

## Goals / Non-Goals

**Goals:**

- One configuration surface for Cursor, on the plugin's own page, with a save path that no other surface competes with.
- Per-model configuration that renders only the controls the live catalog supports, and that never makes the request path wait for network data.
- Live application of saved settings without remounting the plugin.
- One shared, pure resolution module so the host's advertised metadata and the page's display cannot disagree.
- No change to the host product.

**Non-Goals:**

- No per-model reasoning-effort pin (effort stays a request-level choice).
- No editor for catalog parameters outside the five chosen controls (`optimize_for`, `thinking`, arbitrary parameters stay unpinned).
- No changes to session, transcript, usage or latency behavior.
- No localization beyond English.
- No Cursor entry on the Models page, and no host-side "cursor family" editor.

## Decisions

### D1 — Per-model configuration is a dictionary keyed by model id

`models` is a dict: `{ "<model id>": { enabled?, context?, contextWindow?, maxMode?, fast? }, "*": { context?, contextWindow?, maxMode?, fast? } }`. `newModels: enabled|disabled` decides models with no entry. `enabled` is per-model only; the wildcard does not carry it, so a single knob answers "what happens to a model nobody configured".

Alternatives considered: a list like `llm-deepseek`'s `models` (that list *replaces* the catalog; Cursor's catalog is live and remote, so replacement is wrong), and keeping `contextWindows` plus enabled/disabled lists (three sources of truth for the same model).

### D2 — Policy is a live source, not a frozen value

The volatile fields become references. A `ModelPolicySource` reads them per call and is injected into the adapter in place of the frozen `ModelPolicy`; `loader/volatile-update` needs no extra plumbing beyond reading fresh values. The adapter therefore never holds stale policy, and a save does not remount the plugin (which would call `registry.closeAll()` and kill live sessions).

Alternatives considered: ordinary (non-volatile) fields, which remount on save; and copying the resolved policy into a mutable singleton, which hides the dependency and defeats the existing one-way module rule.

### D3 — Advertised window: tier → published capacity → manual → default

Resolved in that order. A manual value is only reachable for a model that neither the provider nor the public catalog describes, which is exactly the set of models the current README apologizes for. The page renders the manual field read-only (showing the automatic value) whenever a higher-priority source applies, so the field can never silently do nothing.

Alternatives considered: manual-first (more intuitive, but lets a stale manual value shadow a real provider tier or a corrected published capacity); a separate "advertised limit" knob per model (two numbers per model, and the earlier `contextWindow`/`contextWindows` surface that this change removes).

### D4 — Published capacity is fetched at runtime from models.dev, projected and cached

A `KnownContext` component mirrors the existing `ModelCatalog` pattern: a synchronous snapshot the request path reads without blocking, an out-of-band refresh with a 24-hour TTL triggered alongside the catalog refresh, and a persisted, gzip-compressed projection on disk. The projection keeps only the ids the catalog currently lists, so the cache stays tiny even though the download is large. Invalid or oversized payloads are discarded; a failed fetch keeps the previous projection. `knownContext: off` disables the fetch entirely.

Tie-breaking is deterministic and conservative: prefer the candidate published by the model's own vendor; among the rest, take the smallest value, so the plugin never advertises more context than some upstream declares.

Alternatives considered: a committed generated table (no runtime dependency, but stale by construction and a maintenance chore); reading the 6 MB document on every boot (a startup cost with no benefit); a per-provider endpoint (models.dev exposes one document).

### D5 — The page is the plugin row's Configure page

Registration targets `plugins.row.config` with key `<package name>#<row id>`. The page therefore lives where the plugin lives, uses the host-provided config form (no bespoke settings remote for reads or writes), and is the only configuration surface for the row: `settings.configure({ auto: false })` states that the generic generated page is not to be offered.

Alternatives considered: `settings.models.provider-card` (the slot intended for external plugins, but it renders *beside* the dead Models card and has no form, so the page would have to speak the settings remote itself); a `settings.section` nav entry (always visible and independent of the row id, but duplicates the place a user looks for plugin configuration and needs its own settings plumbing).

### D6 — The catalog reaches the page through an authenticated plugin route

The page fetches `GET /cursor-to-dsh/catalog.json`, served by the Host half through `ctx.webServer.register` and guarded by `ctx.connection.requestRejection` — the documented way to apply the Host/Origin fence and browser-session authentication to another route. The response carries, per model: id, display name, the published parameter definitions and variants (the shape a catalog-driven form needs), and the published capacity. It carries no credential material.

The route exists only when the Host serves a web carrier; on a headless profile the browser half is never served, so nothing depends on it.

Alternatives considered: extending `LlmDiscoveredModel` with `parameters`/`variants` (the cleanest contract, but requires host types, codecs and codegen — rejected by the "no host change" constraint); a boot-time `webserver/index-inject` snapshot (no new route, but on Desktop the injection is collected once when the Host starts, so a first launch or a newly added model would show generic controls until restart); fetching Cursor directly from the browser (a secret and CORS problem).

### D7 — The plugin stops registering as a configurable provider

Without a directory entry the Models page renders no Cursor row, which is the requested outcome. The route stays registered, so the provider keeps working; the Models page still joins the live route into its rows with an empty settings address, so `providerUsable` keeps treating Cursor as a provider the user can talk to and first-run readiness does not prompt for another key.

The page still needs the row's settings namespace and row id, which the route returns (the Host reads its own entry id). This also tolerates a renamed row: the page registers for the discovered key instead of assuming `llm-cursor`.

Alternatives considered: a host change that hides the Edit affordance for namespaces without curated fields (rejected: no host changes), and keeping the directory entry with an empty editor (keeps the dead card).

### D8 — Discovery registration is removed

With no directory entry, generic surfaces do not ask this namespace for models; the page uses the route. Removing the registration also removes the ambiguity of returning disabled models to a generic model picker.

### D9 — The browser half is TypeScript + JSX bundled by esbuild

The source stays typed and testable. esbuild emits one CommonJS bundle wrapped in the factory prologue/epilogue (`window.__ModuleLoader__.load({ id, factory(require) { ... } })`) with `react`, `react-dom` and the UI primitives left external, since the platform module table answers them. Styles are a scoped stylesheet compiled into the bundle as text and injected once through a `ctx.effect` (removed on dispose), using the product's `--dsw-alias-*` tokens so light and dark themes apply.

Alternatives considered: a hand-written `client.js` with `React.createElement` (no build step, but untyped and unmaintainable for a table-driven page); reproducing the host's `clientBundle` tsdown preset (faithful, but that toolchain is not published and would be a second build system in this repository).

### D10 — The policy resolution is shared source, not duplicated

The pure resolution functions (per-model merge, effective tier, advertised window and its provenance, parameter assembly) live in dependency-free modules that both the Host build and the client bundle compile from source. The route can therefore answer with the provenance the page displays without reimplementing the rules in the browser.

### D11 — Credentials are resolved by one collaborator

Key lookup (credentials file/service, then launch environment) moves into a `CredentialResolver` used by the catalog fetch, the adapter and the route. The page never reads the key; it writes through `credentials.set` and reads only the redacted configured/not-configured state.

### D12 — `src/models.ts` is split by responsibility

Catalog shapes and display names, request-parameter assembly, and policy resolution become separate modules, with the policy module being the shared source from D10. `index.ts` keeps wiring only.

## Risks / Trade-offs

- **A 6 MB download every 24 hours** → background only, gzip-compressed projection on disk, opt-out, no request ever waits, and the previous projection survives a failure.
- **The public catalog can overstate what Cursor serves** → the provider's own tier always wins, ties resolve to the smallest candidate, and every surface labels the value as published upstream rather than measured.
- **A new HTTP route is new attack surface** → it shares the Host API fence and browser-session authentication, returns no secrets, answers read-only JSON, and is absent on headless profiles.
- **The Configure key depends on the row id** → the route returns the real row id and the page registers for it; a rename shows the control after the page reloads.
- **Volatile saves race an in-flight run** → policy is read per request, never retained across awaits, and no save remounts the plugin, so a run is never aborted.
- **Config form revision conflicts** → writes carry the revision the page read and a conflict is surfaced, not swallowed.
- **Clearing a dictionary value could leave an orphan entry** → the page writes path operations including the unset of an emptied entry, covered by a unit test.
- **Browser bundle purity** → only platform modules stay external; everything else is bundled, and the build is checked by loading the artifact in the client module system.
- **Removing fields breaks existing user configuration** → old fields are ignored by the new schema rather than rejected (Schemastery drops undeclared keys), so a profile keeps loading; the README documents the new shape and the migration.
- **Fork leftovers in the package metadata** → the release scripts, badges and repository URLs are removed together with the README sections that referenced them.

## Migration Plan

1. Ship the new configuration shape in `cordis.patch.yml` defaults; the README replaces the old option table.
2. Existing profiles load unchanged: removed fields are ignored, and the advertised windows fall back to the provider tier, the published capacity, then the default.
3. Users who relied on `contextWindows` set per-model context windows on the new page; users who relied on `apiKey` store the key as a credential (page, file, or environment).
4. Rollback is a version revert: the old schema ignores the new fields, so a profile written by the new page still loads under the old plugin.

## Open Questions

- Whether a later change should expose the remaining catalog parameters (`optimize_for`, `thinking`) as per-model pins; the current catalog-driven table leaves room for it without changing the contracts above.
