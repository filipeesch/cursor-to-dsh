# AGENTS.md

DeepSeek Harness (DSH) plugin that registers Cursor as the `cursor` LLM provider route. DSH owns the agent loop, tools and permissions; Cursor is only the model. The session core was ported from the author's Cursor provider for pi (cursor-to-pi) and has since been split into modules.

## Layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | Plugin entry (`name`, `inject`, `Config`, `apply`): key lookup, working directory, state files, adapter registration |
| `src/config.ts` | Config schema and `resolveSettings`: context tier, advertised window, Fast mode, stall window, usage wait, state dir |
| `src/adapter.ts` | `CursorAdapter extends LlmAdapter`: `stream`, `listModels`, `resolveModel`, image cache |
| `src/transcript.ts` | Host `GenerateOptions` -> core transcript (`user` / `developer` / `assistant` / `toolResult`) |
| `src/reply.ts` | Host `StreamChunk` output, the mirrored assistant message and the terminal error codes |
| `src/models.ts` | Cursor catalog -> host model info, model policy -> Cursor params, context tiers, reasoning efforts |
| `src/usage.ts` | Cursor usage -> host disjoint buckets (no combined total) |
| `src/sdk.ts` | Cursor SDK access (agent, catalog, ripgrep path, prewarm) |
| `src/debug.ts` | `DSH_CURSOR_DEBUG` logger |
| `src/diagnostics.ts` | Stall trace appended to the state dir |
| `src/cursor/catalog.ts` | Model catalog as a snapshot the request path reads synchronously, refreshed out of band |
| `src/cursor/context-tier.ts` | The context tier Cursor accepted, per model |
| `src/cursor/state.ts` | State directory resolution and best-effort JSON persistence |
| `src/session/session.ts` | One Cursor agent per host session: run lifecycle, pending tool calls, usage ledger, watchdog |
| `src/session/registry.ts` | Live sessions by key, session key derivation, close-all |
| `src/session/increment.ts` | How the host's new messages map onto the live session |
| `src/session/tools.ts` | Host tools as Cursor custom (MCP) tools, tool-set key, added-tools note |
| `src/session/turn.ts` | One host model call end to end |
| `src/session/usage-ledger.ts` | The provider's report for the open call, and the bounded wait for it |
| `src/session/watchdog.ts` | Inactivity monitor for one provider run |
| `src/prompt/content.ts` | Shared content helpers (text, tool arguments, images) |
| `src/prompt/render.ts` | Transcript rendering, tool results, system-prompt diffing |
| `src/prompt/fingerprint.ts` | Message identity and hashing |
| `cordis.patch.yml` | Bundle layer that inserts the `llm-cursor` row |
| `docs/images/flow.svg` | Sequence diagram source; `flow.png` is rendered from it |

## Commands

```bash
npm install
npm test         # unit tests with the fake Cursor agent
npm run check    # tsc --noEmit
npm run build    # lib/ for the host to load (wipes lib/ first)
npm run check:public  # before any push to GitHub or npm publish
```

Live check (real Cursor, no host): `CURSOR_API_KEY=... node --experimental-strip-types scripts/live.ts`. It prints each call's usage report and when it arrived, which is the measurement the per-call attribution depends on.

Render the diagram after editing the SVG: `rsvg-convert -w 1680 -h 900 docs/images/flow.svg -o docs/images/flow.png`.

## Rules

- Use the host's official seam (`ctx.llm.registerAdapter`); never wrap or patch host internals.
- Cursor's built-in tools stay off. Host tools are Cursor custom (MCP) tools whose `execute` waits for the host's result.
- Host packages (`@deepseek-ai/cordis`, `dsh-llm`, `dsh-credentials`, `dsh-launch-environment`, `schemastery`) are `peerDependencies` + `devDependencies`, never `dependencies`: the host supplies the shared instances.
- Keep the route id `cursor`, model ids, the `llm-cursor` row id and `DSH_CURSOR_*` variables stable; user patches depend on them.
- Error codes stay outside the host's default retry list; a half-finished Cursor run must not be replayed. A stalled run has its own code (`CURSOR_RUN_STALLED`).
- Usage buckets are disjoint and `totalTokens` is omitted; the host discards a total that disagrees with the buckets. Report the provider's per-turn values only, never an estimate.
- Never block a call on the model catalog: the request path reads the snapshot, and refresh happens out of band.
- Dependencies point one way: `index -> adapter -> session/turn -> (session, increment, tools, usage-ledger, watchdog, models, usage, prompt, transcript)`. Pass collaborators in; do not add module-level singletons.
- New behavior gets a test through `CursorAdapter.stream()` in `test/session.test.ts` or a unit test.
- Source must stay type-strippable (no enums, no parameter properties); `lib/` is built by `tsc`, not committed.
- Documentation, code and comments are in English; no Chinese text in tracked files (`npm run check:public` enforces it).
- Do not commit secrets, internal links or local absolute paths; `npm run check:public` enforces the common cases. Publishing runs `prepublishOnly` (type check, tests, build, public check); never bypass it.
