/**
 * Plugin entry: registers Cursor as the `cursor` LLM provider route.
 *
 * The key is read per call: host credentials (`apiKeyEnv`, default `CURSOR_API_KEY`), then the
 * launch environment, then the `apiKey` config. The Cursor agent works in the session's working
 * directory unless `DSH_CURSOR_CWD` or `cwd` overrides it.
 */
import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { join } from "node:path";

import { CursorAdapter } from "./adapter.ts";
import { Config, resolveSettings } from "./config.ts";
import { ModelCatalog, type CatalogSnapshot } from "./cursor/catalog.ts";
import { ContextTierStore } from "./cursor/context-tier.ts";
import { pluginStateDir, readJsonFile, type TierFile, writeJsonFile } from "./cursor/state.ts";
import { createStallDiagnostics } from "./diagnostics.ts";
import { debug } from "./debug.ts";
import { PROVIDER_ID, resolveModelId } from "./models.ts";
import { SessionRegistry } from "./session/registry.ts";
import { createCursorAgent, listCursorModels, prewarmCursor } from "./sdk.ts";

export const name = "cursor-to-dsh";
export const inject = ["llm"];
export { Config };

export function apply(ctx: Context, config: Config): void {
  const settings = resolveSettings(config);
  const stateDir = pluginStateDir(settings.stateDir);
  const catalogFile = join(stateDir, "catalog.json");
  const tiersFile = join(stateDir, "context-tiers.json");

  const keyRef = (): string => {
    const value = config?.apiKeyEnv;
    const current = typeof value === "string" ? value : value?.get?.();
    return (typeof current === "string" && current.trim()) || "CURSOR_API_KEY";
  };

  const resolveApiKey = async (): Promise<string | undefined> => {
    const ref = keyRef();
    const credentials: any = (ctx as any).get("credentials");
    if (credentials) {
      try {
        const hit = await credentials.resolve(credentialRef(ref));
        if (hit?.value?.trim()) return hit.value.trim();
      } catch (err) {
        debug(`credentials lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const ambient = launchEnvironmentOf(ctx).get(ref)?.value?.trim();
    return ambient || config?.apiKey?.trim() || undefined;
  };

  const cwdFor = (sessionId: string | undefined): string => {
    const override = process.env.DSH_CURSOR_CWD?.trim() || config?.cwd?.trim();
    if (override) return override;
    try {
      const session = sessionId ? (ctx as any).get("sessions")?.get?.(sessionId) : undefined;
      const dir = session ? (ctx as any).get("workingDirectory")?.get?.(session) : undefined;
      if (typeof dir === "string" && dir) return dir;
    } catch (err) {
      debug(`working directory lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return process.cwd();
  };

  const readImage = async (ref: any, signal?: AbortSignal) => {
    const attachments: any = (ctx as any).get("attachments");
    if (!attachments?.readImage) return undefined;
    const stored = await attachments.readImage(ref, signal);
    return { data: Buffer.from(stored.data).toString("base64"), mimeType: stored.ref?.mediaType ?? ref.mediaType };
  };

  const prewarmEnabled = !/^(0|false|off)$/i.test(process.env.DSH_CURSOR_PREWARM ?? "");
  const catalog = new ModelCatalog({
    listModels: listCursorModels,
    resolveApiKey,
    persist: (snapshot: CatalogSnapshot) => writeJsonFile(catalogFile, { version: 1, ...snapshot }),
    onLive: (opts) => {
      // Pay the SDK's one-time per-process setup in the background, once a live catalog proves the key works.
      if (prewarmEnabled) void prewarmCursor(opts);
    },
  });
  catalog.load(readJsonFile<CatalogSnapshot>(catalogFile));

  const tiers = new ContextTierStore(ContextTierStore.from(readJsonFile<TierFile>(tiersFile)), (accepted) =>
    writeJsonFile(tiersFile, { version: 1, tiers: accepted }),
  );

  const registry = new SessionRegistry();
  const recordStall = createStallDiagnostics(stateDir);

  const adapter = new CursorAdapter({
    createAgent: createCursorAgent,
    resolveApiKey,
    cwdFor,
    readImage,
    catalog,
    tiers,
    registry,
    policy: settings.policy,
    stallTimeoutMs: settings.stallTimeoutMs,
    onStall: (session, info) =>
      recordStall({ key: session.key, model: session.modelId || resolveModelId("auto"), elapsedMs: info.elapsedMs, lastEvent: info.lastEvent }),
  });

  (ctx as any).llm.registerConfigurableProviders([
    { provider: PROVIDER_ID, displayName: "Cursor", settingsNs: (ctx as any).fiber?.entry?.options.id ?? name, settingsPath: [] },
  ]);
  (ctx as any).llm.registerAdapter([PROVIDER_ID], adapter);
  ctx.effect(() => () => registry.closeAll(), "cursor sessions");
  // Warm the catalog off the request path; a call never waits for it.
  void catalog.refresh().catch(() => {});
}
