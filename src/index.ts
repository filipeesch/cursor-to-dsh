/**
 * Plugin entry: registers Cursor as the `cursor` LLM provider route.
 *
 * The key is read per call through one credential resolver (host credentials, then the launch
 * environment). The Cursor agent works in the session's working directory unless `DSH_CURSOR_CWD`
 * or `cwd` overrides it. The configuration page reads the live catalog from an authenticated route
 * and writes settings through the host's own config form, so nothing here knows about the page's
 * layout.
 */
import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { join } from "node:path";

import { CursorAdapter } from "./adapter.ts";
import { Config, resolveSettings } from "./config.ts";
import { DEFAULT_KEY_REF, PROVIDER_ID } from "./constants.ts";
import { CredentialResolver } from "./credentials.ts";
import { ModelCatalog, type CatalogSnapshot } from "./cursor/catalog.ts";
import { ContextTierStore } from "./cursor/context-tier.ts";
import { KnownContext, type KnownContextSnapshot } from "./cursor/known-context.ts";
import {
  pluginStateDir,
  readGzipJsonFile,
  readJsonFile,
  writeGzipJsonFile,
  writeJsonFile,
  type TierFile,
} from "./cursor/state.ts";
import { debug } from "./debug.ts";
import { createStallDiagnostics } from "./diagnostics.ts";
import { resolveModelId } from "./model-catalog.ts";
import { registerCatalogRoute } from "./route.ts";
import { SessionRegistry } from "./session/registry.ts";
import { createCursorAgent, listCursorModels, prewarmCursor } from "./sdk.ts";

export const name = "cursor-to-dsh";
export const inject = ["llm"];
export { Config };

export function apply(ctx: Context, config: Config): void {
  const settings = resolveSettings(config);
  const stateDir = pluginStateDir(settings.stateDir);
  const catalogFile = join(stateDir, "catalog.json");
  const knownFile = join(stateDir, "known-context.json.gz");
  const tiersFile = join(stateDir, "context-tiers.json");
  // The settings namespace and the browser half's Configure registration are both keyed by the row.
  const rowId: string = (ctx as any).fiber?.entry?.options.id ?? name;

  const keyRef = (): string => {
    const value = config?.apiKeyEnv;
    const current = typeof value === "string" ? value : value?.get?.();
    return (typeof current === "string" && current.trim()) || DEFAULT_KEY_REF;
  };

  const credentials = new CredentialResolver({
    ref: keyRef,
    credentials: () => {
      const service: any = (ctx as any).get("credentials");
      if (!service?.resolve) return undefined;
      return { resolve: (ref: string) => service.resolve(credentialRef(ref)) };
    },
    environment: () => launchEnvironmentOf(ctx),
  });
  const resolveApiKey = (): Promise<string | undefined> => credentials.resolve();

  const cwdFor = (sessionId: string | undefined): string => {
    const override = process.env.DSH_CURSOR_CWD?.trim() || config?.cwd?.trim();
    if (override) return override;
    try {
      const session = sessionId ? (ctx as any).get("sessions")?.get?.(sessionId) : undefined;
      const dir = session ? (ctx as any).get("workingDirectory")?.get?.(session) : undefined;
      if (typeof dir === "string" && dir) return dir;
    } catch (err) {
      debug("working directory lookup failed: " + (err instanceof Error ? err.message : String(err)));
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
      // The published capacities are projected onto the ids the catalog currently lists.
      known.note();
    },
  });
  catalog.load(readJsonFile<CatalogSnapshot>(catalogFile));

  const known = new KnownContext({
    modelIds: () => catalog.current().map((model) => model.id),
    enabled: () => settings.knownContext(),
    persist: (snapshot: KnownContextSnapshot) => writeGzipJsonFile(knownFile, snapshot),
  });
  known.load(readGzipJsonFile<KnownContextSnapshot>(knownFile));

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
    readPolicy: settings.readPolicy,
    publishedWindow: (modelId: string) => known.windowFor(modelId),
    stallTimeoutMs: settings.stallTimeoutMs,
    onStall: (session, info) =>
      recordStall({ key: session.key, model: session.modelId || resolveModelId("auto"), elapsedMs: info.elapsedMs, lastEvent: info.lastEvent }),
  });

  registerCatalogRoute(ctx, {
    rowId,
    settingsNs: rowId,
    models: () => catalog.current(),
    publishedWindow: (modelId: string) => known.windowFor(modelId),
    acceptedTier: (modelId: string) => tiers.get(modelId),
    knownContext: () => ({ enabled: settings.knownContext(), fetchedAt: known.fetchedAt() }),
  });

  (ctx as any).llm.registerAdapter([PROVIDER_ID], adapter);
  // This plugin ships its own configuration page, so the product's generated page is not offered.
  ctx.inject(["settings"], (child: any) => {
    child.effect(
      () => child.settings.configure({ auto: false }, (ctx as any).fiber),
      "cursor-to-dsh: own configuration page",
    );
  });
  ctx.effect(() => () => registry.closeAll(), "cursor sessions");
  // Warm the catalog off the request path; a call never waits for it.
  void catalog.refresh().then(() => known.note()).catch(() => {});
}
