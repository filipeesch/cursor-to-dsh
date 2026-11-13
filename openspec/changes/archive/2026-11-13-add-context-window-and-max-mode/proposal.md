# Proposal

## Why

The host's context meter is wrong for more than half of the Cursor catalog. Fourteen of the 26 models publish no `context` parameter, so the plugin advertises a hardcoded 200,000 — the user's own default model, `deepseek-v41-flash-1017`, is one of them. Nothing in the provider's data supports that number; it is a placeholder wearing a measurement.

The other twelve models do publish tiers (300k/1m, 256k/500k, 272k/1m), and every variant at the **largest** tier is Cursor's Max Mode. The pinned SDK (1.0.37) predates `isMaxMode`/`maxMode`, so the plugin requests a Max Mode tier as if it were an ordinary one and the provider refuses it: `grok-4.7` is persisted at 256k although 500k is offered. The plugin has been silently running those models at the smaller tier.

## What Changes

- **Bump `@cursor/sdk` 1.0.37 -> 1.3.1**: the first series that exposes `variants[].isMaxMode` and derives `ModelSelection.maxMode` from the catalog. It also adds conversation-summary messages, which this change does not consume.
- **Per-model context window**: new `contextWindows` option, a map from model id to a token count, with `"*"` as the fallback for every model not named. Precedence: model entry, wildcard, the existing `contextWindow` value, the tier the provider accepted, then a documented default. The 200,000 placeholder stops being the only answer for models the provider does not describe.
- **Explicit Max Mode policy**: new `maxMode: auto | on | off`, **default `off`**, so the provider's more expensive extended-context mode is never entered without a decision. With `off`, "largest tier" means the largest tier that does not require Max Mode, which is what the plugin actually runs today.
- **Tier selection respects the policy**: a Max Mode-only tier is skipped when the policy is `off`, and selected with the flag set when the policy is `on` or `auto`.
- **Documentation**: configuration table, the reason Max Mode costs more, and the precedence order.

Not changing: the requested tier still defaults to the largest the policy allows; Fast mode, reasoning effort, catalog persistence and the stall watchdog are untouched.

**BREAKING**: none in configuration shape. Behaviour for the twelve tiered models changes only if `maxMode: on` is set; the default keeps the tier that actually ran before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-configuration`: the advertised window gains a per-model/wildcard precedence and stops presenting a default as a measurement; tier selection becomes subject to an explicit Max Mode policy; a new requirement states that Max Mode is never entered implicitly.

## Impact

- `package.json`, `package-lock.json`: `@cursor/sdk` 1.3.1 (lockfile must keep public registry URLs; the machine's default npm registry is internal).
- `src/config.ts`: `contextWindows` and `maxMode` options, and their resolution into the model policy.
- `src/models.ts`: window precedence, Max Mode-only tier detection, typed catalog variants.
- `src/session/turn.ts` (and the agent creation it drives): pass the Max Mode flag when the policy asks for it.
- `README.md`, `AGENTS.md`: configuration table and dependency note.
- Tests: `test/models.test.ts` for precedence and tier selection, `test/units.test.ts` for settings resolution, `test/session.test.ts` for the flag reaching the agent.
