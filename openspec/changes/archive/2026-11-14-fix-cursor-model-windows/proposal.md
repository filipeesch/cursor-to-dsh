# Proposal

## Why

Three defects showed up on the page:

- The models come in Cursor's catalog order, which starts with the two Auto entries and ends with DeepSeek; scanning 26 rows is harder than it should be.
- DeepSeek V4.1 Flash 1017 is advertised as 262k and GPT-5.5 as 400k, though both offer a 1M window. The published-capacity projection treats any entry whose provider name or id path mentions the vendor as the vendor's own, so a third-party PEFT variant of DeepSeek that declares 262k joins the "vendor" pool, and the conservative smallest-candidate tie-break then picks it. The persisted snapshot kept those values for the day.
- A model with no published capacity (Composer 2.5) shows an empty window field, which reads as "no window", even though the documented default applies.

## What Changes

- Order the models in the catalog document alphabetically by display name.
- Replace the published-capacity tie-break: prefer entries published by the model's own **vendor provider**, and when none carries the model, the capacity **most candidates declare**, preferring the larger on a tie. Bump the snapshot version so a snapshot produced under the old rule is discarded.
- Prefill the manual window field with the window in effect, so a model that only has the documented default still shows a number; the field stays editable and writes an override when changed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `model-configuration`: the published-capacity requirement drops the smallest-candidate rule and names the vendor-provider preference.
- `cursor-settings-ui`: the model-table requirement adds alphabetical ordering.

## Impact

- `src/cursor/known-context.ts` (projection and snapshot version), `src/catalog-payload.ts` (order), `src/client/derive.ts` (prefilled window), their tests, and the two spec deltas.
