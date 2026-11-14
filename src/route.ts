/**
 * The authenticated catalog route the configuration page reads.
 *
 * A DSH plugin cannot add a generated Remote namespace without a host change, so the page reads
 * this read-only route instead. It applies the same Host/Origin fence and browser-session
 * authentication as the product's own API routes through the composition's connection service, and
 * it answers JSON with no credential material.
 */
import { CATALOG_PATH } from "./constants.ts";
import { catalogPayload, type CatalogPayload } from "./catalog-payload.ts";
import type { CatalogModel } from "./model-catalog.ts";

/** What the route answers from. */
export interface CatalogRouteDeps {
  /** Loader row id, which the page's Configure registration is keyed by. */
  rowId: string;
  /** Settings namespace of that row. */
  settingsNs: string;
  /** The catalog as the request path sees it. */
  models: () => readonly CatalogModel[];
  /** Published capacity for one model, when the fallback snapshot describes it. */
  publishedWindow: (modelId: string) => number | undefined;
  /** Tier the provider already accepted for one model, when one is remembered. */
  acceptedTier: (modelId: string) => string | undefined;
  /** Whether the fallback is enabled, and when it last refreshed. */
  knownContext: () => { enabled: boolean; fetchedAt?: number };
}

/** Build the payload the route answers; pure so a test can assert on it. */
export function payloadFor(deps: CatalogRouteDeps): CatalogPayload {
  return catalogPayload({
    rowId: deps.rowId,
    settingsNs: deps.settingsNs,
    models: deps.models(),
    publishedWindow: deps.publishedWindow,
    acceptedTier: deps.acceptedTier,
    knownContext: deps.knownContext(),
  });
}

/** The connection service selection this route applies; the full type lives browser-side. */
interface ConnectionFence {
  requestRejection(request: { readonly headers: unknown }): 401 | 403 | undefined;
}

/**
 * Register the catalog route beside the composition's web server.
 *
 * The registration waits for the web server and never blocks plugin activation: a profile without
 * a web carrier simply never serves the page that reads this route.
 * @param ctx - plugin context.
 * @param deps - what the route answers from.
 */
export function registerCatalogRoute(ctx: any, deps: CatalogRouteDeps): void {
  ctx.inject(["webServer"], (child: any) => {
    child.effect(() => child.webServer.register({
      kind: "exact",
      path: CATALOG_PATH,
      handler: (request: any, response: any) => {
        const fence = Reflect.get(child, "connection") as ConnectionFence | undefined;
        if (!fence) {
          response.statusCode = 401;
          response.end();
          return;
        }
        const rejection = fence.requestRejection(request);
        if (rejection !== undefined) {
          response.statusCode = rejection;
          response.end();
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("allow", "GET, HEAD");
          response.end();
          return;
        }
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(payloadFor(deps)));
      },
    }), "cursor-to-dsh: GET " + CATALOG_PATH);
  });
}
