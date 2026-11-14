# Design

## Context

See proposal.md for motivation. The archived `add-cursor-settings-ui` change delivered the page, the catalog route, the per-model configuration and the published-capacity fallback. This change reworks the page's interaction model and removes Max Mode, which the platform no longer needs: Cursor's own picker now selects context windows directly, the upcharge is gone for usage-based plans, and Max Mode survives only for legacy request-based plans.

## Goals / Non-Goals

**Goals:** one line and zero extra clicks per model; direct context-tier choice; autosave with no save control; no Max Mode in configuration, policy or UI.

**Non-Goals:** changing the published-capacity fallback, the credential flow, the catalog route or the session core.

## Decisions

### D1 — Max Mode leaves the plugin entirely

The configuration, the per-model settings, the policy, the tier filter, the agent flag and the "· Max" label are removed. The context tier is chosen directly, and "Auto" means the largest offered tier. Evidence: Cursor's docs state Max Mode is available only on legacy request-based plans, and Cursor's own staff reply on the removal for usage-based pricing says the 20% upcharge was removed and larger windows are selected directly.

Alternatives considered: keeping `maxMode` as a config-only switch (nobody discovers it from the page, and its default would keep capping tiers) and keeping the flag but defaulting it on (sends a parameter the platform is retiring).

### D2 — One line per model, product segmented controls

Each row renders the enablement checkbox, the name and id, then — only when the catalog supports them — an inline `SegmentedControl` for the context tier and one for Fast. The control comes from `@deepseek-ai/dsh-client-ui-primitives`, which the module table already serves, so the page looks and behaves like the rest of the product. The expandable Settings row is deleted.

Alternatives considered: a column grid (cramped cells and holes for unsupported controls) and keeping the expandable row (the clicks the change removes).

### D3 — Autosave through a small debounced writer

A control change updates the local view immediately and schedules one write after 400 ms, replacing any pending write for the same field. The write is the same path operation the previous page produced on Save; a refusal or transport failure discards the optimistic value, adopts the host's accepted value and shows the message. No in-flight indicator: the page only speaks when something fails. Pending writes are flushed when the page unmounts, so a closed page does not lose the last click.

Alternatives considered: writing on every keystroke (a write per digit), a longer debounce (the control feels laggy on fast edits) and keeping the Save footer (what the change removes).

### D4 — The global context preference becomes configuration-only

"Auto" resolves to the largest offered tier, so the page no longer needs a global largest/smallest control. The `context` configuration field remains for profile patches and is what "Auto" follows.

## Risks / Trade-offs

- **A failed write without a visible in-flight state** → the control rolls back and the message names the refusal; the debounce keeps the window small.
- **Removing a configuration field breaks existing profiles** → the field is ignored by the new schema, the README documents the removal, and the default behaviour (largest tier) is what the removed default nearly always produced.
- **Segmented controls depend on the product's primitive** → it is a baseline module already shared with the product's own settings pages; the bundle keeps it external and the build smoke loads it.
- **Unmounting mid-debounce** → the pending write is flushed on dispose.
