/**
 * Browser half of the Cursor provider plugin.
 *
 * It contributes the row's Configure page in Settings -> Plugins, which is where the product lets
 * a plugin own its own configuration surface. The page reads the live catalog from the plugin's
 * authenticated route and writes settings through the host's own configuration form; the only
 * thing it writes directly is the API key credential, which is not part of the configuration.
 */
import type { Context as ClientContext } from "@deepseek-ai/cordis";

import type { CatalogPayload } from "../catalog-payload.ts";
import { CATALOG_PATH, DEFAULT_ROW_ID, PACKAGE_NAME } from "../constants.ts";
import { CatalogController } from "./controller.ts";
import { CursorRowConfig } from "./page.ts";
import { STYLES } from "./styles.ts";

/** Bumped whenever the catalog document changes shape; the page refuses what it cannot read. */
const PAYLOAD_VERSION = 1;

/** The slot service, narrowed to the one registration this plugin makes. */
interface SlotsLike {
  inject(
    name: string,
    callback: () => () => void,
  ): () => void;
  register(options: { name: string; id: string; key: string; inject: () => object }, component: any): () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fetch the catalog the plugin's Host half serves. */
async function fetchCatalog(): Promise<CatalogPayload> {
  const response = await fetch(CATALOG_PATH, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("catalog route answered " + response.status);
  const payload = (await response.json()) as CatalogPayload;
  if (payload?.version !== PAYLOAD_VERSION || !Array.isArray(payload.models)) {
    throw new Error("catalog route answered an unsupported document");
  }
  return payload;
}

/** Redacted credential state, or undefined when the read failed. */
async function describeKey(ctx: any, reference: string): Promise<boolean | undefined> {
  const credentials = ctx.remote?.credentials;
  if (!credentials?.describe) return undefined;
  try {
    const response = await credentials.describe([reference]);
    if (!response.ok) return undefined;
    return response.value?.[reference]?.configured === true;
  } catch {
    return undefined;
  }
}

/** Store one credential; resolves to a refusal message, or undefined once stored. */
async function setKey(ctx: any, reference: string, value: string): Promise<string | undefined> {
  const credentials = ctx.remote?.credentials;
  if (!credentials?.set) return "the credentials service is unavailable";
  try {
    const response = await credentials.set(reference, value);
    return response.ok ? undefined : response.error?.message ?? "the host refused the write";
  } catch (error: unknown) {
    return messageOf(error);
  }
}

/** Install the stylesheet once for the life of the plugin. */
function installStyles(): () => void {
  if (typeof document === "undefined") return () => {};
  const tag = document.createElement("style");
  tag.dataset.plugin = PACKAGE_NAME;
  tag.textContent = STYLES;
  document.head.append(tag);
  return () => {
    tag.remove();
  };
}

export const inject = ["slots", "remote"];

export function apply(ctx: ClientContext): void {
  const slots = (ctx as unknown as { slots: SlotsLike }).slots;
  const context = ctx as any;
  const controller = new CatalogController({
    fetchCatalog,
    describeKey: (reference) => describeKey(context, reference),
    setKey: (reference, value) => setKey(context, reference, value),
  });
  ctx.effect(installStyles, "cursor-to-dsh: styles");

  const registrations = new Map<string, () => void>();
  // Row ids the route reported; remembered so a re-declared slot registers them again.
  const discovered = new Set<string>();
  let declared = false;

  const register = (rowId: string): void => {
    const key = PACKAGE_NAME + "#" + rowId;
    if (registrations.has(key)) return;
    registrations.set(key, slots.register({
      name: "plugins.row.config",
      id: PACKAGE_NAME,
      key,
      inject: () => ({ controller }),
    }, CursorRowConfig));
  };

  slots.inject("plugins.row.config", () => {
    declared = true;
    register(DEFAULT_ROW_ID);
    for (const rowId of discovered) register(rowId);
    return () => {
      declared = false;
      for (const dispose of registrations.values()) dispose();
      registrations.clear();
    };
  });

  // A renamed row id is still this plugin's row: the route reports it, and the page follows.
  void controller.loadCatalog().then((payload) => {
    const rowId = payload?.rowId;
    if (rowId === undefined || rowId.length === 0) return;
    discovered.add(rowId);
    if (declared) register(rowId);
  });
}
