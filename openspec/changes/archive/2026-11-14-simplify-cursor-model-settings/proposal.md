# Proposal

## Why

Cursor removed Max Mode from the model picker for usage-based pricing: the same context windows are selectable directly, and the 20% Max Mode upcharge is gone (it survives only on legacy request-based plans). The plugin still treats Max Mode as a live policy: with the default `maxMode: off` it refuses the 1M/500k tiers, so a request that could use the largest window at the same price is silently capped at 300k/272k.

The configuration page also costs more clicks than it should: per-model settings sit behind a Settings toggle and the page still requires an explicit Save, while the product's own controls are segmented buttons that can write on change.

## What Changes

- **BREAKING**: remove `maxMode` from the configuration, the per-model settings and the policy. There is no Max Mode flag, no tier filtering and no "· Max" label; the context tier is chosen directly and "Auto" means the largest tier the model offers.
- **BREAKING**: remove the page's global context control; the `context` configuration field remains (config/YAML only) as what "Auto" follows.
- Turn the per-model settings into one line per model with inline segmented controls (the product's `SegmentedControl`), removing the Settings toggle and the expandable row.
- Replace the page's Save footer with autosave: each control writes through after a 400 ms debounce, with no in-flight indicator; a refused write rolls the control back and shows the error.
- Keep the API key section as it is (state + Change key) and the new-model default as a checkbox.
- Update the specs: `model-configuration` loses the Max Mode requirement and its tier/window requirements stop mentioning the policy; `cursor-settings-ui` gains the inline controls and the autosave contract.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-configuration`: Max Mode requirement removed; the tier and advertised-window requirements drop the Max Mode policy from their rules.
- `cursor-settings-ui`: the configuration page requirement covers inline segmented controls and autosave, and drops the global context control.

## Impact

- `src/config.ts`, `src/policy/**`, `src/model-tiers.ts`, `src/model-params.ts`, `src/session/turn.ts`, `cordis.patch.yml`, README and AGENTS.md lose Max Mode.
- `src/client/**` is reworked: `derive.ts` (inline rows), `views.ts` (segmented controls, no footer save), `page.ts` (autosave), a new `autosave.ts` with the debounce and its tests.
- Tests updated across `policy`, `tiers`, `params`, `session` and the browser half.
