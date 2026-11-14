# Design

## Decisions

### D1 — A checked-in table for what the provider documents and never publishes

Composer 2.5 publishes only `fast`; models.dev has no entry for it; Cursor's own model page states "Context window 200k". `src/documented-capacities.ts` holds that number keyed by the exact catalog id, with the source URL and the date read, and resolves between the manual value and the generic default. It is shared by both halves, so the advertised window and the page agree, and it is dependency-free like the other shared modules.

### D2 — A manual value still wins, so the field stays editable

A provider-documented capacity is better information than a guess, not better than an explicit choice: the manual value keeps its precedence and the field keeps showing the number prefilled for the documented case.

### D3 — Provenance moves to the control, not to a label

The chip duplicated the number that the field already showed and read as noise. The window now lives in the editable field when it can be edited and in a number-only chip when it cannot; the source is the control's `title` and part of its accessible name.

## Risks

- **A stale table** would advertise an outdated number: the entry carries the source URL and the date read, and the spec makes the published capacity and the manual value take precedence.
