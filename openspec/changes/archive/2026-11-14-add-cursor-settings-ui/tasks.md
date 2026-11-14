# Tasks

## 1. Configuration and live policy

- [x] 1.1 Rework the Config schema: make `apiKeyEnv`, `context`, `maxMode`, `fast`, `models`, `newModels` and `knownContext` volatile, and remove `apiKey`, `contextWindow` and `contextWindows`; verify with `npm run check` and that an old profile config still parses
- [x] 1.2 Implement the pure per-model merge (`models[id]` over `models["*"]` over globals) and the `enabled`/`newModels` resolution in a shared module, and verify with unit tests covering entries, wildcard, defaults and unlisted entries
- [x] 1.3 Implement the pure tier/window resolution and provenance (tier, published capacity, manual value, default, in that order) and verify with unit tests covering each source and the read-only precedence rule
- [x] 1.4 Introduce a live policy source that reads the volatile references per call and inject it into `CursorAdapter` in place of the frozen policy; verify with a test that changing a reference between calls changes the request parameters without remounting the plugin
- [x] 1.5 Split `src/models.ts` into catalog metadata, request parameters and policy modules so no module mixes concerns, and verify the existing model tests still pass after imports move
- [x] 1.6 Extract credential resolution (credentials service, then launch environment) into one collaborator used by catalog, adapter and route, and verify with unit tests for both lookups and the missing case

## 2. Catalog and published capacity

- [x] 2.1 Implement the published-capacity snapshot beside the model catalog: fetch `https://models.dev/api.json` out of band with a 24-hour TTL, project only the currently listed ids, persist gzip-compressed, keep the previous projection on failure, and honour `knownContext: off`; verify with unit tests using a fake fetch and a fake clock
- [x] 2.2 Implement the deterministic match and tie-break (prefer the model's own vendor, otherwise the smallest candidate) and verify with unit tests for exact, ambiguous and missing matches
- [x] 2.3 Feed the published capacity into the advertised window and its provenance, and verify with unit tests for a tier-less model with and without a published entry
- [x] 2.4 Filter disabled models out of `listModels` while `resolveModel` keeps resolving them, and verify through `CursorAdapter` tests plus a case for a saved selection naming a disabled model
- [x] 2.5 Stop registering the provider as configurable and stop registering model discovery, then verify the plugin still loads, the route stays registered, and the Models page lists no Cursor row

## 3. Catalog route

- [x] 3.1 Register the authenticated catalog route (web carrier plus connection fence, read-only JSON) and verify with handler tests: authenticated answers, missing session refuses, and no credential or key material appears in the payload
- [x] 3.2 Build the route payload with the row id, the settings namespace, each model's parameters and variants, and the published capacity; verify with a unit test over a fixture catalog and that the route is absent when no web carrier is present

## 4. Browser half

- [x] 4.1 Add the client build: `dsh.client` declaration, `./client` export, `files` entry, client tsconfig and an esbuild step emitting `lib/client.js` in the module-loader factory format; verify the artifact registers itself with a stub loader and that React and the UI primitives stay external
- [x] 4.2 Register the row's Configure page (keyed by package and row id discovered from the route, summary view plus the page, automatic generated page disabled) and verify with a client-side unit test against fake slots, form and remote services
- [x] 4.3 Implement the page sections: masked API key with save and redacted status, global context preference, model table and the new-model default; verify with pure derivation tests and a rendered-state test for key configured and missing
- [x] 4.4 Implement the per-model editors: tier selector only when the catalog publishes tiers (marking Max Mode tiers), context window only when no higher-priority source applies, Fast and Max Mode only when the catalog supports them, plus the not-described and catalog-unavailable states; verify with derivation tests for each catalog shape
- [x] 4.5 Implement saving and clearing as path operations, including the unset that removes an emptied entry, and verify with unit tests that clearing restores inheritance and leaves no orphan entry
- [x] 4.6 Add the scoped stylesheet with theme tokens, injected once through a plugin effect and removed on dispose, and verify light and dark rendering in `dsh web`
- [x] 4.7 Confirm every visible string is English and passes `npm run check:public`

## 5. Documentation and packaging

- [x] 5.1 Update `cordis.patch.yml` defaults to the new configuration shape and verify the plugin loads with the default patch
- [x] 5.2 Rewrite the README: the Configure page, the API key path, the new options table, the published-capacity caveat, the removals, migration notes, and removal of the fork's npm badges, registry install, agent install prompt and stale authorship; verify links and sections against the shipped behavior
- [x] 5.3 Remove the fork's package metadata (author, repository, homepage, bugs, publish-only scripts) while keeping the package name, route id, row id and environment variables stable, and verify `npm run check:public`
- [x] 5.4 Update the AGENTS.md layout and commands tables for the client half, the new modules and the build step

## 6. Validation

- [x] 6.1 Run the full gate (`npm run check`, `npm test`, `npm run build`, `npm run check:public`) and verify all pass
- [ ] 6.2 Smoke the feature in `dsh web`: store a key from the page, enable and disable a model, set a tier, verify the picker follows, reload, and verify the model table still renders
- [ ] 6.3 Smoke the feature in Desktop against a linked checkout: Configure appears on the plugin row, the catalog route answers, a save applies to the next request, and a run in progress is not aborted
- [x] 6.4 Run `openspec validate add-cursor-settings-ui --strict` and verify it passes
