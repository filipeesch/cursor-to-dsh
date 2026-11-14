# Tasks

## 1. Remove Max Mode

- [x] 1.1 Drop `maxMode` from the configuration, the policy and the per-model settings, and verify the type check plus the policy tests
- [x] 1.2 Remove the tier filter, the Max Mode flag sent at agent creation and the `isMaxMode` helpers, and verify the tier and session tests
- [x] 1.3 Update `cordis.patch.yml`, the README and AGENTS.md, and verify `npm run check:public`

## 2. Rework the page

- [x] 2.1 Add the debounced autosave writer with its unit tests (last write wins per field, flush on dispose, failure reported)
- [x] 2.2 Render each model on one line with the product `SegmentedControl` for the context tier and Fast, dropping the expandable row and the footer save
- [x] 2.3 Wire the page to autosave: optimistic value, rollback on refusal, no in-flight indicator, key section and new-model checkbox unchanged in behaviour
- [x] 2.4 Update the browser half's tests for the new views, derivation and autosave, and verify `npm test`

## 3. Verify and capture

- [x] 3.1 Run the full gate (check, test, build, client smoke, check:public) and `openspec validate --strict`
- [x] 3.2 Regenerate the page previews and screenshots (light, dark, expanded state replaced by inline rows, degraded states)
- [x] 3.3 Merge the change, archive it and sync the specs
