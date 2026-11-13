# Tasks

## 1. Dependency

- [x] 1.1 Bump `@cursor/sdk` to `1.3.1` with the public registry; verify `package.json` pins the exact version and `package-lock.json` contains no internal registry URL (`npm run check:public`).
- [x] 1.2 Verify the surface the plugin uses still exists (`Agent.create`, `Agent.delete`, `Cursor.models.list`, `send`, `stream`, `wait`, `cancel`) with a smoke import; verify `npm run check` and `npm test` pass on the new dependency.

## 2. Configuration

- [x] 2.1 Add `contextWindows` (model id -> token count, `"*"` wildcard) and `maxMode` (`auto|on|off`, default `off`) to the config schema and to the resolved settings; verify `resolveSettings` unit tests cover defaults, explicit values and invalid input.
- [x] 2.2 Extend the model policy with the max-mode state and the per-model window map; verify `test/units.test.ts` asserts the resolution for each.

## 3. Model resolution

- [x] 3.1 Implement window precedence (model entry, wildcard, global value, accepted tier, documented default) in `advertisedContextWindow`; verify tests cover every step of the chain and that the default is only used when nothing else applies.
- [x] 3.2 Type `CatalogModel.variants` and implement Max Mode-only tier detection; verify tests with a catalog fixture where the largest tier is marked and one where no marking exists.
- [x] 3.3 Make tier selection honour the policy: `off` skips Max Mode-only tiers, `on` selects the largest with the flag, `auto` leaves it to the provider; verify one test per policy against the same fixture.
- [x] 3.4 Pass `maxMode: true` to agent creation only when the policy is `on`; verify a fake-agent test asserts the flag reaches `createAgent` for `on` and is absent for `off` and `auto`.

## 4. Documentation

- [x] 4.1 Document `contextWindows` and `maxMode` in the README configuration table, with the precedence order and the cost note for Max Mode; verify the table lists every environment override and default.
- [x] 4.2 Note in `AGENTS.md` that the SDK is pinned for catalog metadata and that window defaults are documented rather than inferred; verify the rules still describe the code.

## 5. Release

- [x] 5.1 Run `npm run prepublishOnly`; verify check, tests, build and the public check all pass.
- [x] 5.2 Bump the package version to `0.3.0`; verify `package.json` and that `prepublishOnly` succeeds after the bump.
- [x] 5.3 Re-read the live catalog once and record which tiers each model offers and which are Max Mode; verify the recorded table matches the README note about the default.

  Measured with `@cursor/sdk@1.3.1` against the live catalog (26 models):

  | Model | Tiers offered | Max Mode |
  |---|---|---|
  | `claude-haiku-5-5` | 300k, 1m | 1m only (10/10 variants) |
  | `claude-opus-5-5` | tiered | largest tier only |
  | `grok-4.7` | 256k, 500k | 500k only (4/4 variants) |
  | `gpt-5.6-sol` | 272k, 1m | 1m only (5/5 variants) |
  | `deepseek-v41-flash-1017` | none (reasoning effort only) | none |

  Summary: 12 of 26 models publish a context tier, and exactly those 12 carry Max Mode variants; every variant at the largest tier is Max Mode, and no smaller tier is. The other 14 models — including the `deepseek-v41-flash-1017` default — publish no tier and therefore no Max Mode.
