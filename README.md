# cursor-to-dsh

> Use Cursor models as the `cursor` LLM provider in DeepSeek Harness (DSH) and DeepSeek Desktop, through the official `@cursor/sdk` and your own Cursor API key. DSH keeps the agent loop, tools and permissions; Cursor is only the model.

Register Cursor as a model provider named `cursor` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH, including DeepSeek Desktop). DSH owns the agent loop, tools and permissions; Cursor only provides the model.

![One conversation with a tool call: DSH hands tools to Cursor, Cursor hands the call back to DSH, and the result returns to the same Cursor run](docs/images/flow.png)

## Features

- **Official SDK only**: uses Cursor's `@cursor/sdk` and your own API key. No private protocol, no Cursor IDE session; registered through the host seam `ctx.llm.registerAdapter`, with no host patches.
- **Tools belong to the host**: Cursor's built-in file, shell and edit tools stay off. Reading, writing and running commands happen in DSH, under DSH's sandbox and approvals.
- **Cache reuse**: one Cursor agent per DSH session, and only new content is sent. Tool results return into the same run.
- **Per-call usage**: the provider's usage report for each model turn is what reaches the host, so throughput, token and context meters show what Cursor actually billed for that call.
- **Honest model metadata**: the context window reported to the host is the tier Cursor accepted, including after an automatic step-down; a model the catalog does not describe falls back to a capacity published upstream, then to a manual value, then to a documented default.
- **Configured in the product**: the plugin's own page in Settings -> Plugins stores the API key, picks which models are offered, and sets the context tier, Max Mode and Fast mode per model.
- **Stalls are visible**: a run that stops producing content is abandoned with a clear error and a diagnostic, instead of waiting forever.
- **Images**: images in user messages and tool results are forwarded to Cursor.

## Install

Requires DSH `0.2.0-rc.2` or newer (DeepSeek Desktop bundles `0.2.1-rc.2`).

The plugin is installed from a local checkout. Build it once (`npm install && npm run build`), then point the profile at that directory.

**DeepSeek Desktop**: the `desktop` profile is managed by the desktop app, and `dsh plugin add` fails with `managed exclusively by the Electron application`. Edit it by hand:

1. Quit DeepSeek Harness Desktop completely.
2. In `~/.dsh/profiles/desktop/package.json`, append two entries without touching the existing ones:

   ```json
   {
     "dependencies": { "cursor-to-dsh": "link:/absolute/path/to/this/checkout" },
     "dsh": { "profile": { "bundles": ["…existing entries…", "cursor-to-dsh"] } }
   }
   ```

3. Install with the pnpm the app ships, then start it:

   ```bash
   cd ~/.dsh/profiles/desktop
   node "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs" install
   open -a "DeepSeek Harness"
   ```

**Any other profile**: add the same `link:` dependency and bundle entry to that profile's `package.json` and run its install once.

### API key

Create a key at [cursor.com/dashboard](https://cursor.com/dashboard) -> API Keys -> New API Key (a personal key or a service account key; Team Admin keys are not supported).

Open **Settings -> Plugins -> cursor-to-dsh -> Configure** and paste the key into the API key field. It is stored as a write-only credential under `CURSOR_API_KEY`; the page never reads it back.

A key that lives outside the product is still honoured. Put it in `~/.dsh/.credentials.yaml` (mode `0600`, hot reloaded):

```yaml
version: 1
refs:
  CURSOR_API_KEY: <your key>
```

Lookup order: credentials service -> `CURSOR_API_KEY` environment variable.

### Verify

Cursor appears as a provider for conversations, and **Settings -> Plugins -> cursor-to-dsh -> Configure** opens its page. You can also set `agent-default-model` to `provider: cursor`.

## Configuration

The page covers everyday use. To pin values in a profile patch instead, override this plugin's row in the profile's `cordis.patch.yml` (a patch replaces the whole `config`, so write every field you need):

```yaml
- id: llm-cursor
  name: cursor-to-dsh
  config:
    apiKeyEnv: CURSOR_API_KEY
    context: max
    models:
      "*":
        maxMode: "off"
      deepseek-v41-flash-1017:
        enabled: true
        contextWindow: 1000000
    newModels: enabled
    maxMode: "off"
    fast: "off"
    knownContext: "on"
    timing: "off"
    stallTimeoutMs: 120000
```

| Option | Default | Environment override | Meaning |
|---|---|---|---|
| `apiKeyEnv` | `CURSOR_API_KEY` | | Credential / environment variable that holds the Cursor API key |
| `context` | `max` | `DSH_CURSOR_CONTEXT` | Global context tier preference: `max` (largest the Max Mode policy allows) or `min`. A model entry may name one of its offered tiers, such as `300k` |
| `models` | none | | Per-model settings keyed by model id; `"*"` covers models without their own entry: `enabled`, `context`, `contextWindow` (tokens), `maxMode`, `fast` |
| `newModels` | `enabled` | | Whether a model with no entry of its own is offered: `enabled` or `disabled` |
| `maxMode` | `off` | | Cursor Max Mode, the extended-context mode Cursor bills differently: `off` never requests a Max-Mode-only tier, `on` requests the largest tier with the flag, `auto` leaves it to Cursor's catalog |
| `fast` | `off` | | Cursor Fast (priority, higher-cost) mode: `off`, `on`, or `auto` to leave it to Cursor |
| `knownContext` | `on` | | Fetch published model capacities from models.dev as the fallback: `on` or `off` |
| `timing` | `off` | | Write one timing record per model step to the state directory: `on` or `off` |
| `stallTimeoutMs` | `120000` | `DSH_CURSOR_STALL_TIMEOUT_MS` | Milliseconds without provider content before a run is abandoned; `0` disables the watchdog |
| `cwd` | session working directory | `DSH_CURSOR_CWD` | Cursor agent working directory |

The advertised context window is resolved in this order: the provider tier in effect (including a tier Cursor accepted after a step-down), the capacity published upstream for that model, a manual per-model value, then the documented default of `200000`. A manual value never overrides a provider tier or a published capacity; the page only offers the field when nothing more authoritative applies.

Other environment variables:

- `DSH_CURSOR_DEBUG=1` writes debug lines to stderr.
- `DSH_CURSOR_PREWARM=0` disables warm-up. The plugin starts it as soon as it is applied, from the persisted catalog, so a live catalog fetch is not required first; warm-up pays the Cursor SDK's one-time per-process setup in the background instead of on the first step.
- `DSH_CURSOR_STATE_DIR` overrides where the plugin keeps its small persisted files, defaulting to the DSH home (`~/.dsh`). It stores the cached model catalog, the accepted context tier per model, the gzip-compressed published-capacity snapshot, `stall.log`, and `timing.log` when the `timing` option is on (it grows one line per step; delete it or turn the option off).

## Known limitations

- File attachments, offloaded images and unreadable images are not forwarded to Cursor; they become a placeholder note. Replaying history carries only the last user message's images.
- Cursor reports usage **once per run**, accumulated over every model call the run made. The plugin divides that report by the number of calls the run served and reports it once, on the run's last call, so the host sees one request's worth of usage. Session totals therefore read as the run's average request rather than the sum of every call — without that division the context meter reads N times the real context and compaction triggers on a conversation that is not full. When Cursor reports nothing, the host is told nothing; the plugin never invents a number.
- A tool call is handed to DSH as soon as it is ready: the collection window starts at **0 ms** and no part of the delivery waits for a usage report. When a sibling call arrives after its turn's delivery, the plugin learns how late it was and gives that model a window that would have covered the gap — never above 50 ms, and never when the gap is too wide to cover. A turn that carries a single tool call (the common PTC case) keeps the 0 ms window. A model whose gaps fit the ceiling pays that split once and batches afterwards; a model whose gaps exceed it keeps today's behaviour, where each such turn splits.
- Not every Cursor model publishes a context tier: 13 of the 26 in the current catalog do not, including `deepseek-v41-flash-1017` and the `auto` entries. Those models use the capacity published upstream (models.dev) when it describes them, else a manual value, else the documented default (`200000`). The published value is a capacity the upstream catalog declares, not a capacity measured from Cursor.
- Max Mode is the tier Cursor offers at the largest context, and it is billed differently. It stays off unless `maxMode` says otherwise, so `context: max` lands on the largest tier that runs without it.
- `stop` is not supported (`UNSUPPORTED_OPTION`); `temperature` and `maxTokens` are ignored.

## Development

```bash
npm install && npm run build   # the host loads lib/ and the browser loads lib/client.js; rebuild and restart after a source change
npm test                       # unit tests with a fake Cursor agent
npm run check                  # type check, host, browser and live-check halves
npm run check:public           # no internal links, local paths or non-English text
CURSOR_API_KEY=... node --experimental-strip-types scripts/live.ts [model]   # real Cursor run
```

The live script prints, for every call, the provider's usage report and how long after the call started it arrived. That is the measurement the per-call usage attribution depends on.

The browser half is TypeScript compiled by `scripts/build-client.mjs` into one module-loader factory bundle (`lib/client.js`). React and the UI primitives stay external because the product's module table supplies them.

Point Desktop at a local checkout by writing the dependency as `"cursor-to-dsh": "link:<absolute repo path>"`.

Try a run inside a real host without touching your profile (paths in the overlay must be absolute):

```yaml
# /tmp/cursor-overlay.yml
- insert:
    - id: llm-cursor
      name: <absolute repo path>/lib/index.js
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: cursor
    model: claude-haiku-5-5
```

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
CURSOR_API_KEY=... DSH_CURSOR_DEBUG=1 "$DSH" --profile headless --patch /tmp/cursor-overlay.yml --json "Read README.md and summarize it in one line"
```

In the debug log, the call that delivers tool results shows `plan=results`, and the second turn of a conversation shows `plan=send`. A plugin mounted with `--patch` uses its own copy of the host packages, so error codes become `UNKNOWN`; use it for trial runs only.

Architecture and constraints are in [AGENTS.md](AGENTS.md); the sequence diagram source is [docs/images/flow.svg](docs/images/flow.svg).

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Luke.
