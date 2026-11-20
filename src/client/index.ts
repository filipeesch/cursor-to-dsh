/**
 * Browser half of the Cursor provider plugin.
 *
 * It contributes the row's Configure page in Settings -> Plugins, which is where the product lets
 * a plugin own its own configuration surface. The page reads the live catalog from the plugin's
 * authenticated route and writes settings through the host's own configuration form; the only
 * thing it writes directly is the API key credential, which is not part of the configuration.
 */
import type { Context as ClientContext } from "@deepseek-ai/cordis";

import { CATALOG_VERSION, type CatalogPayload } from "../catalog-payload.ts";
import { CATALOG_PATH, DEFAULT_ROW_ID, PACKAGE_NAME } from "../constants.ts";
import { CatalogController } from "./controller.ts";
import { CursorRowConfig } from "./page.ts";
import { STYLES } from "./styles.ts";

// The module table supplies the shared UI primitives to every plugin bundle. The bundle's factory
// receives `require`; a plain ESM import of this file (tests) has none, so the lookup is guarded.
declare const require: (id: string) => any;

function loadPrimitives(): { SegmentedControl?: any } {
  if (typeof require !== "function") return {};
  try {
    return require("@deepseek-ai/dsh-client-ui-primitives") ?? {};
  } catch {
    return {};
  }
}

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

/**
 * The condition behind a refused catalog read, in words the reader can act on.
 *
 * The host answers a route that throws with a body-less `400`, so the status alone cannot tell a
 * broken plugin from a build that predates the route. Each known refusal gets its own sentence and
 * keeps the number, which is what a maintainer needs.
 * @param status - the status the route answered.
 * @returns the message for that status.
 */
export function catalogReadError(status: number): string {
  // Each message is the whole sentence the page shows: what failed, what the reader can do next,
  // and the status for diagnosis. The status alone cannot identify a cause, so an unknown one
  // states only what is certain rather than guessing.
  if (status === 401) return "The model catalog is unavailable: your DSH browser session is missing or expired. Reopen the page from DSH, then select Reload catalog. (HTTP 401)";
  if (status === 403) return "The model catalog is unavailable: DSH refused this caller access. Sign in as the host owner, then select Reload catalog. (HTTP 403)";
  if (status === 404) return "The model catalog is unavailable: this DSH build does not serve the catalog route. Update the plugin to a version that matches your DSH. (HTTP 404)";
  if (status === 503) return "The model catalog is unavailable: DSH could not confirm who is asking. Restart DSH, then select Reload catalog. (HTTP 503)";
  if (status === 400) return "The model catalog is unavailable: DSH could not answer the request. Select Reload catalog to try again; if it still fails, report HTTP 400 to your administrator.";
  return "The model catalog is unavailable. Select Reload catalog to try again. (HTTP " + status + ")";
}

/** Fetch the catalog the plugin's Host half serves. */
async function fetchCatalog(): Promise<CatalogPayload> {
  const response = await fetch(CATALOG_PATH, { credentials: "same-origin", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(catalogReadError(response.status));
  const payload = (await response.json()) as CatalogPayload;
  if (payload?.version !== CATALOG_VERSION || !Array.isArray(payload.models)) {
    throw new Error("the catalog document has a shape this page cannot read (version " + String(payload?.version) + ")");
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

export const inject = ["slots", "remote", "remote.credentials"];

export function apply(ctx: ClientContext): void {
  const slots = (ctx as unknown as { slots: SlotsLike }).slots;
  const context = ctx as any;
  const controller = new CatalogController({
    fetchCatalog,
    describeKey: (reference) => describeKey(context, reference),
    setKey: (reference, value) => setKey(context, reference, value),
  });
  ctx.effect(installStyles, "cursor-to-dsh: styles");

  const { SegmentedControl } = loadPrimitives();
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
      inject: () => ({ controller, segmented: SegmentedControl }),
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
