# Design

## Context

See `proposal.md` - Why. Constraints that shape the approach:

- The provider's catalog describes context **only** as a `context` parameter with tier values, per model. There is no numeric window field in any SDK version; the protobuf for a catalog entry carries `max_mode` as a boolean and nothing about capacity.
- Measured on the live catalog with SDK 1.3.1: 26 models, 12 publish a `context` parameter, and exactly those 12 have variants marked `isMaxMode`. The marking is not an extra dimension — **every variant at the largest tier is Max Mode** (`claude-haiku-5-5`: 1m 10/10 marked, 300k 0/10; `grok-4.7`: 500k 4/4, 256k 0/4; `gpt-5.6-sol`: 1m 5/5, 272k 0/5).
- SDK 1.3.1 derives `maxMode` at agent creation: it matches the catalog variants compatible with the requested params and sets the flag when all of them are Max Mode. 1.0.37 has no such notion, which is why the largest tier was requested without the flag and rejected.
- The host requires a positive `contextWindow` from model resolution: compaction validates it and refuses a model without one. Omission is not an option.

## Goals / Non-Goals

**Goals:**

- One place that answers "what window do we advertise for this model", with an explicit precedence chain.
- Max Mode reachable only by an explicit decision, with the cheaper tier preserved as the default.
- Keep the plugin's dependency on the provider current enough to see the flags it already publishes.

**Non-Goals:**

- Inferring a provider capacity the catalog does not publish.
- Changing what the host does with the number (meter denominator, compaction budget).
- Consuming the SDK's new conversation-summary messages; that is a separate concern.

## Decisions

### 1. A per-model map, with a wildcard, above the existing global value

`contextWindows` is a map of model id to token count, with `"*"` as the fallback. Resolution order: model entry, `"*"`, the existing `contextWindow` value, the accepted tier, then a documented default. The wildcard exists because the interesting case is not "one model is special" but "fourteen models are undescribed" — one entry fixes all of them.

Why not a single global value: it would claim a capacity for models whose real tier is smaller, making the meter under-report occupancy and letting compaction overshoot.

Why not infer from the largest offered tier as the default for undescribed models: those models publish no tiers at all; there is nothing to infer from.

### 2. Max Mode is off by default and filters tier selection

With the policy off, a tier is selectable only if not every variant carrying it is marked Max Mode. With the policy on, the largest tier is requested and the flag is sent. With the policy provider-derived, the tier is requested unchanged and the SDK's own derivation decides the flag.

Default off is deliberate: Max Mode is Cursor's extended-context mode and is billed differently. The plugin has been effectively running the smaller tier until now, so defaulting to off keeps the deployed behaviour exactly as it is and makes the expensive tier an explicit opt-in.

Why not default provider-derived: it would silently move every tiered model onto Max Mode, because the default requested tier is the largest.

### 3. Detect "requires Max Mode" from the catalog variants

A tier value requires Max Mode when at least one variant carries that `context` value and every such variant is marked. When no variant carries the value, or no marking exists (an older cached catalog), the tier is treated as selectable — the request then fails or succeeds on its own merits, and the existing step-down handles a rejection.

Why not a dedicated catalog flag per tier: the provider does not publish one; the marking lives on the variant, which is the same unit the SDK matches against.

### 4. Send the flag only when the policy asks

The selection passed to agent creation carries `maxMode: true` only for the `on` policy. For provider-derived the plugin sends plain params and lets the SDK decide, so a future catalog change does not need a plugin change.

### 5. Type the catalog variants

`CatalogModel.variants` becomes a typed list of `{ params, displayName?, isMaxMode? }` instead of `unknown[]`. The persisted catalog carries the field, so reading it needs no extra request.

## Risks / Trade-offs

- **Enabling Max Mode changes billing** -> default off; documented, with the exact option to turn it on.
- **A cached catalog written by the old SDK has no `isMaxMode`** -> treated as unmarked, so the first request after an upgrade may still hit a Max Mode tier without the flag and step down once; the refreshed catalog corrects it. Mitigation: the refresh runs at load, and the accepted tier is persisted.
- **A stale persisted tier can pin a model to the small tier after the upgrade** -> the accepted tier is only reused when it is still offered and allowed by the policy; deleting the state file resets it.
- **A map option is awkward in the settings UI** -> the README shows the `cordis.patch.yml` form, which is how it is normally set; the global scalar still covers the common case.
- **SDK minor bump 1.0.37 -> 1.3.1** -> the surface we use (`Agent.create/delete`, `Cursor.models.list`, `send`, `stream`, `wait`, `cancel`, `local.customTools`) is unchanged; the full gate and a live catalog read were run against it.

## Migration Plan

1. Bump the dependency with the public registry so the lockfile keeps public URLs.
2. Land the configuration and resolution changes behind defaults that preserve current behaviour.
3. Update documentation, including how to opt into Max Mode.
4. Release as `0.3.0`. Rollback: revert the version; the new options are ignored by the previous release.

## Open Questions

None that change the build. Whether Cursor bills these models' Max Mode differently per model is a commercial detail the default-off policy already accounts for.
