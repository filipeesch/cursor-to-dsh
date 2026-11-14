# Design

## Decisions

### D1 — The vendor provider's own entry wins, then the most-declared capacity

Candidates are the entries whose id segment or name equals the model id. Among them, entries whose **provider** normalizes to the model's vendor are preferred; if there are none, every candidate counts. The value is the most frequent capacity in that pool (larger on a tie) instead of the smallest.

Why not the smallest: the smallest rule let a third-party reduced-window variant (a 262k PEFT build of DeepSeek under a path that merely starts with `deepseek-ai`) override the vendor's 1M declaration, and the user sees a wrong window on a model they know. Using the provider identity removes the "path mentions the vendor" loophole, and taking the most-declared value ignores one-off gateway limits.

### D2 — A snapshot carries the rule version

The projection lives in a gzip snapshot persisted for a day. A snapshot written by the old rule would keep the wrong windows until the next 24-hour refresh, so the snapshot version is bumped: a snapshot under another version is ignored (and therefore refreshed) rather than trusted.

### D3 — Alphabetical order in the catalog document

The order belongs to the document the page and any other consumer read, not to one view, so it is applied where the payload is built. The model picker keeps Cursor's own order, which the host passes through.

### D4 — The window field shows the window in effect

For a model whose window comes from the documented default, the editable field is prefilled with that number instead of being empty; the chip still names the provenance, and editing writes a manual override. This changes nothing about precedence, only what the field looks like before an edit.

## Risks

- **A wrong vendor declaration** would be advertised as-is; the step-down already recovers from a rejected tier, and the field stays editable per model.
- **Ordering changes the snapshot's tests**: the payload order is asserted directly.
