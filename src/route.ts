/**
 * The authenticated catalog route the configuration page reads.
 *
 * A DSH plugin cannot add a generated Remote namespace without a host change, so the page reads
 * this read-only route instead.
 *
 * Trust fencing and browser-session authentication belong to the host. Two host generations exist:
 * recent sources resolve an `auth` policy and answer `webserver/authorize` before dispatch, while
 * every published release dispatches the handler with only `(req, res)`. The one admission seam
 * both carry is `connection.admit(request)`, so the handler calls it itself and fails closed when
 * it is unavailable. The route then adds the check admission cannot make: that the admitted
 * caller owns this host.
 */
import { CATALOG_PATH } from "./constants.ts";
import { catalogPayload, type CatalogPayload } from "./catalog-payload.ts";
import type { CatalogModel } from "./model-catalog.ts";

/** What the route answers from. */
export interface CatalogRouteDeps {
  /** Loader row id, which the page's Configure registration is keyed by. */
  rowId: string;
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
    models: deps.models(),
    publishedWindow: deps.publishedWindow,
    acceptedTier: deps.acceptedTier,
    knownContext: deps.knownContext(),
  });
}

/** The identity of an admitted caller, narrowed to the one field this route reads. */
export interface RoutePeer {
  readonly principal?: { readonly kind?: string };
}

/** What the host answered when asked to admit one request. */
export type RouteAdmission =
  | { readonly peer: RoutePeer }
  | { readonly rejection: 401 | 403 | 503 };

/** The request facts the host admission reads. */
export interface RouteRequest {
  readonly headers: unknown;
  readonly method?: string;
  readonly url?: string;
}

/**
 * The connection selection this route reads.
 *
 * One optional method, declared as data rather than imported from the host, so the plugin does
 * not couple to a host type it does not control. `admit` is the seam every published release
 * carries; the newer `webserver/authorize` admission is not on those releases at all.
 */
export interface RouteFence {
  admit?(request: RouteRequest): RouteAdmission;
}

/** The one identity this route answers for: the local user who owns the host. */
export const OWNER = "owner";

/**
 * Whether an admitted caller may read the catalog.
 * @param peer - the peer the host admitted, or undefined when admission produced none.
 * @returns true only for the host owner.
 */
export function isOwner(peer: RoutePeer | undefined): boolean {
  return peer?.principal?.kind === OWNER;
}

/**
 * Admit one request through the host, failing closed.
 *
 * A host without the admission seam, or an admission that throws, grants nothing: the route
 * answers `503` because it cannot establish who is calling, never because it assumed an owner.
 * @param fence - the connection selection, or undefined when the host has none.
 * @param request - the incoming request facts.
 * @returns the admitted peer, or the status refusing the request.
 */
export function admitRequest(fence: RouteFence | undefined, request: RouteRequest): { peer?: RoutePeer; refusal?: 401 | 403 | 503 } {
  if (typeof fence?.admit !== "function") return { refusal: 503 };
  let admission: RouteAdmission;
  try {
    admission = fence.admit(request);
  } catch {
    return { refusal: 503 };
  }
  if (admission === undefined || admission === null) return { refusal: 503 };
  if ("rejection" in admission) return { refusal: admission.rejection };
  const peer = admission.peer as RoutePeer | undefined;
  // A host that admits without a peer proves nothing about the caller.
  if (peer === undefined || peer === null) return { refusal: 401 };
  return { peer };
}

/**
 * Register the catalog route beside the composition's web server.
 *
 * The registration waits for the web server and never blocks plugin activation: a profile
 * without a web carrier simply never serves the page that reads this route. The connection
 * service is read per request rather than injected, so a host without it still registers the
 * route and is refused with `503` instead of silently serving nothing.
 * @param ctx - plugin context.
 * @param deps - what the route answers from.
 */
export function registerCatalogRoute(ctx: any, deps: CatalogRouteDeps): void {
  ctx.inject(["webServer"], (web: any) => {
    web.effect(() => web.webServer.register({
      kind: "exact",
      path: CATALOG_PATH,
      handler: (request: any, response: any) => {
        let fence: RouteFence | undefined;
        try {
          fence = (ctx as any).get?.("connection");
        } catch {
          fence = undefined;
        }
        const admission = admitRequest(fence, request);
        if (admission.refusal !== undefined) {
          response.statusCode = admission.refusal;
          response.end();
          return;
        }
        // The host proved who is calling; this route decides whether that caller is its audience.
        if (!isOwner(admission.peer)) {
          response.statusCode = 403;
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
