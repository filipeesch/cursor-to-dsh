# Proposal

## Why

Composer 2.5 is one of the most used models in the picker and its window was only the generic documented default: its catalog entry publishes no context tier, models.dev has no entry for it, and Cursor's own model page states the 200k capacity without publishing it anywhere the plugin can read. A model the provider documents should be configured, not left on the fallback.

The page also carries a provenance chip on every row ("200k · documented default"), which is noise next to a field that already shows the number.

## What Changes

- Add a checked-in table of capacities the provider documents but never publishes, read between the manual value and the documented default, seeded with `composer-2.5` = 200,000 from Cursor's model page.
- Stop rendering provenance as a label: a value that a field can hold lives in the field, a value that cannot lives in a chip with the number only, and the source stays on the control's tooltip and accessible name.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-configuration`: the advertised-window precedence gains the provider-documented capacity.
- `cursor-settings-ui`: the provenance requirement no longer demands a separate label.

## Impact

- `src/documented-capacities.ts` (new, shared), `src/policy/context.ts`, `src/client/derive.ts`, `src/client/views.ts`, their tests, AGENTS.md and the two spec deltas.
