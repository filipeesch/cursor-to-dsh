# Proposal

## Why

The Cursor provider can only be configured by hand-editing `cordis.patch.yml` and `.credentials.yaml`. The Models page renders no curated fields for the `llm-cursor` namespace (its editor card is empty), the plugin's only settings-editable field is the credential reference, and 11 of the 26 models Cursor currently publishes carry no context tier, so the host is told a placeholder 200,000-token window for them (DeepSeek included). A user cannot set the API key, see the model list, enable or disable a model, or correct a capacity from the product.

## What Changes

- Add a Cursor configuration page inside **Settings → Plugins → cursor-to-dsh → Configure**, provided by a new browser half of this plugin (`dsh.client` + `./client` factory bundle, built with esbuild). The page replaces the generic auto-generated config form for the row.
- Store the API key from the page as a **credential** (masked field, show/hide, Save). The secret is written through `credentials.set` and never read back.
- Add per-model configuration (`models` dict keyed by model id, plus a `"*"` wildcard): `enabled`, context tier, context window, Max Mode and Fast, rendered only for the controls a model's catalog entry actually offers.
- Add `newModels: enabled|disabled` deciding what happens to a catalog model with no entry of its own. Default `enabled`.
- Resolve the advertised context window as: catalog tier (when the model publishes one) → known published capacity → manual per-model value → documented 200,000 default. Known capacities come from the public `models.dev` catalog, fetched by the Host in the background with a 24-hour TTL and persisted gzip-compressed; `knownContext: on|off` disables the fetch (default `on`).
- Add an authenticated Host route the page uses to read the live catalog with each model's parameters and variants, because `llm.discoverModels` cannot carry that shape.
- Make the model-policy fields volatile and re-read them on `loader/volatile-update`, so saving a setting applies without remounting the plugin and live Cursor sessions survive.
- **BREAKING**: remove `apiKey`, `contextWindow` and `contextWindows` from the plugin configuration; the credential file, environment variable or the new page are the only key sources, and per-model configuration replaces the old window maps.
- **BREAKING**: stop registering `cursor` as a configurable provider, so the Cursor row disappears from **Settings → Models**. The route stays registered, so the provider keeps working and onboarding still sees it as usable.
- Remove the `llm.registerModelDiscovery` registration; the new route serves the catalog to the page.
- Split model metadata, request parameters and policy into focused modules, introduce a live policy source injected into the adapter, and extract credential resolution from the plugin entry.
- Update the README and package metadata: document the page, remove the fork's npm badges, registry install path, agent install prompt and stale authorship/URLs.

## Capabilities

### New Capabilities

- `cursor-settings-ui`: the Cursor configuration page in Settings → Plugins — API key storage, catalog-driven model table, per-model settings, new-model default, and the authenticated catalog route that feeds it.

### Modified Capabilities

- `model-configuration`: per-model configuration replaces the configured-window precedence and the global window overrides; the advertised window gains a published-capacity source with provenance; disabled models leave the advertised catalog while still resolving for saved selections.

## Impact

- `src/index.ts` (wiring, directory registration removed, route registration, discovery removed), `src/config.ts` (schema and volatile policy), `src/adapter.ts` (live policy, filtered `listModels`), `src/models.ts` split into metadata/parameters/policy modules, `src/cursor/*` (new known-capacity snapshot beside the model catalog).
- New `src/client/**` browser half, `tsconfig.client.json`, an esbuild build step and a `lib/client.js` artifact published in `files`.
- `package.json` (`dsh.client`, `./client` export, de-forked metadata), `cordis.patch.yml` (default config), `README.md`.
- New outbound HTTPS dependency on `https://models.dev/api.json` (background, opt-out) and a new authenticated HTTP route served by the plugin.
- Tests: policy resolution, catalog/known-capacity snapshots, enabled filtering through `CursorAdapter`, route handler authentication, and the page's pure derivation logic.
