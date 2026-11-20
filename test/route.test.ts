import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG_PATH } from "../src/constants.ts";
import { CATALOG_VERSION } from "../src/catalog-payload.ts";
import { admitRequest, isOwner, payloadFor, registerCatalogRoute, type CatalogRouteDeps, type RouteFence } from "../src/route.ts";

const models = [
  {
    id: "claude",
    displayName: "Claude Opus 5.5",
    parameters: [
      { id: "context", displayName: "Context", values: [{ value: "300k", displayName: "300K" }, "1m"] },
      { id: "fast", values: [{ value: "false" }, { value: "true" }] },
    ],
    variants: [
      { params: [{ id: "context", value: "1m" }], isMaxMode: true, displayName: "Max" },
      { params: [{ id: "context", value: "300k" }], isDefault: true },
    ],
  },
  { id: "deepseek", displayName: "DeepSeek V4.1 Flash" },
  { id: "m" },
];

const deps: CatalogRouteDeps = {
  rowId: "llm-cursor",
  models: () => models as any,
  publishedWindow: (modelId: string) => (modelId === "deepseek" ? 1_048_576 : undefined),
  acceptedTier: (modelId: string) => (modelId === "claude" ? "300k" : undefined),
  knownContext: () => ({ enabled: true, fetchedAt: 1_700_000_000_000 }),
};

/** The identity the host fixes for the local user who owns it. */
const owner = { principal: { kind: "owner" } };

test("the payload lists the models alphabetically by display name", () => {
  const unordered = [
    { id: "zeta", displayName: "Zeta" },
    { id: "alpha", displayName: "Alpha" },
    { id: "beta", displayName: "beta" },
  ];
  const payload = payloadFor({ ...deps, models: () => unordered as any });
  assert.deepEqual(payload.models.map((model) => model.id), ["alpha", "beta", "zeta"], "case does not change the order");
});

test("the payload carries the row identity and the catalog shape the page renders", () => {
  const payload = payloadFor(deps);
  assert.equal(payload.version, CATALOG_VERSION);
  assert.equal(payload.provider, "cursor");
  assert.equal(payload.rowId, "llm-cursor");
  assert.deepEqual(payload.knownContext, { enabled: true, fetchedAt: 1_700_000_000_000 });

  const claude = payload.models[0];
  assert.equal(claude.id, "claude");
  assert.equal(claude.name, "Claude Opus 5.5");
  assert.deepEqual(claude.parameters[0], {
    id: "context",
    displayName: "Context",
    values: [{ value: "300k", displayName: "300K" }, { value: "1m" }],
  });
  assert.deepEqual(claude.variants[0], { params: [{ id: "context", value: "1m" }], isMaxMode: true, displayName: "Max" });
  assert.deepEqual(claude.variants[1], { params: [{ id: "context", value: "300k" }], isDefault: true });
  assert.equal(claude.acceptedTier, "300k");
  assert.equal(claude.publishedContextWindow, undefined);

  assert.equal(payload.models[1].publishedContextWindow, 1_048_576);
  assert.deepEqual(payload.models[2].parameters, []);
  assert.deepEqual(payload.models[2].variants, []);
});

test("the payload carries no credential or key material", () => {
  const json = JSON.stringify(payloadFor(deps));
  assert.doesNotMatch(json, /apiKey|secret|credential|bearer|CURSOR_API_KEY/i);
});

test("the payload names the row and nothing that repeats it", () => {
  const payload = payloadFor(deps) as unknown as Record<string, unknown>;
  assert.equal(payload.rowId, "llm-cursor");
  assert.doesNotMatch(JSON.stringify(payload), /settingsNs/, "the row id already identifies the row");
});
function fakeResponse(): any {
  const response: any = { statusCode: 0, headers: {} as Record<string, string>, body: undefined as string | undefined, ended: false };
  response.setHeader = (name: string, value: string) => {
    response.headers[name.toLowerCase()] = value;
  };
  response.end = (body?: string) => {
    response.body = body;
    response.ended = true;
  };
  return response;
}

/**
 * A host that serves a web carrier and admits through the connection seam.
 *
 * `admits` stands in for the host credential check: it is handed the request facts the route
 * passes, so a test can assert the route really asked before it answered.
 */
function fakeContext(options: {
  admits?: (request: any) => any;
  withConnection?: boolean;
  withWebServer?: boolean;
} = {}): { ctx: any; routes: any[]; asked: any[]; state: { attempts: number } } {
  const routes: any[] = [];
  const asked: any[] = [];
  const state = { attempts: 0 };
  const connection = options.withConnection === false ? undefined : {
    admit: (request: any) => {
      asked.push(request);
      return options.admits ? options.admits(request) : { peer: owner };
    },
  };
  const ctx: any = {
    get: (name: string) => (name === "connection" ? connection : undefined),
    inject: (dependencies: string[], callback: (child: any) => void) => {
      state.attempts += 1;
      // Cordis runs the callback only once every named service is present; a host that serves
      // no web carrier never invokes it at all.
      if (!dependencies.includes("webServer")) return;
      if (options.withWebServer === false) return;
      const child: any = { effect: (fn: () => any) => fn() };
      child.webServer = {
        register: (route: any) => {
          routes.push(route);
          return () => {};
        },
      };
      callback(child);
    },
  };
  // `attempts` is read after the call, so it reflects every injection the route requested.
  return { ctx, routes, asked, state };
}

test("only the host owner may read the catalog", () => {
  assert.equal(isOwner(owner as any), true, "the local user who owns the host reads it");
  assert.equal(isOwner({ principal: { kind: "share-viewer" } } as any), false, "another admitted identity may not");
  assert.equal(isOwner({} as any), false, "an identity with no principal may not");
  assert.equal(isOwner(undefined), false, "an admission that produced no peer may not");
});

test("admission hands back the peer the host proved, and refuses otherwise", () => {
  // The route must ask the host, never infer an identity from the request.
  const granted = admitRequest({ admit: () => ({ peer: owner }) }, { headers: {} });
  assert.equal(granted.peer, owner);
  assert.equal(granted.refusal, undefined);

  // Every refusal the host can state is handed back unchanged.
  for (const status of [401, 403, 503] as const) {
    const refused = admitRequest({ admit: () => ({ rejection: status }) }, { headers: {} });
    assert.equal(refused.refusal, status);
    assert.equal(refused.peer, undefined);
  }
});

test("a host that cannot prove who is calling is refused, never assumed to be the owner", () => {
  // No connection service at all, a service without admit, an admission that throws, and an
  // admission that succeeds without naming a peer all fail closed.
  assert.equal(admitRequest(undefined, { headers: {} }).refusal, 503, "no connection service");
  assert.equal(admitRequest({} as RouteFence, { headers: {} }).refusal, 503, "a service with no admit seam");
  assert.equal(admitRequest({ admit: () => { throw new Error("boom"); } }, { headers: {} }).refusal, 503, "an admission that throws");
  assert.equal(admitRequest({ admit: () => undefined as any }, { headers: {} }).refusal, 503, "an admission that answers nothing");
  assert.equal(admitRequest({ admit: () => ({}) as any }, { headers: {} }).refusal, 401, "an admission that carries no peer");
});

test("the route registers one exact path and answers the owner host admission proved", () => {
  const { ctx, routes, asked } = fakeContext();
  registerCatalogRoute(ctx, deps);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, "exact");
  assert.equal(routes[0].path, CATALOG_PATH);

  const response = fakeResponse();
  const request = { method: "GET", headers: { host: "127.0.0.1:3080" } };
  routes[0].handler(request, response);
  assert.equal(asked.length, 1, "the route asks the host about this request");
  assert.equal(asked[0], request, "the host sees the request facts, not a synthesized summary");
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(response.body!).rowId, "llm-cursor");
});

test("an unauthenticated request is refused before any catalog data leaves the route", () => {
  const { ctx, routes } = fakeContext({ admits: () => ({ rejection: 401 }) });
  registerCatalogRoute(ctx, deps);
  const response = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body, undefined);
});

test("an untrusted source is refused, and so is a host with no authorization decision", () => {
  const untrusted = fakeContext({ admits: () => ({ rejection: 403 }) });
  registerCatalogRoute(untrusted.ctx, deps);
  const refused = fakeResponse();
  untrusted.routes[0].handler({ method: "GET", headers: { host: "attacker.example" } }, refused);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body, undefined);

  const undecided = fakeContext({ admits: () => ({ rejection: 503 }) });
  registerCatalogRoute(undecided.ctx, deps);
  const unavailable = fakeResponse();
  undecided.routes[0].handler({ method: "GET", headers: {} }, unavailable);
  assert.equal(unavailable.statusCode, 503, "no decision is not permission");
  assert.equal(unavailable.body, undefined);
});

test("an admitted caller that does not own the host is refused", () => {
  const { ctx, routes } = fakeContext({ admits: () => ({ peer: { principal: { kind: "share-viewer" } } }) });
  registerCatalogRoute(ctx, deps);
  const response = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body, undefined, "no catalog data leaves the route");
});

test("an admission carrying no peer is refused rather than treated as the owner", () => {
  const { ctx, routes } = fakeContext({ admits: () => ({ peer: {} }) });
  registerCatalogRoute(ctx, deps);
  const response = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body, undefined);
});

test("only GET and HEAD are answered, and admission runs first", () => {
  const { ctx, routes, asked } = fakeContext();
  registerCatalogRoute(ctx, deps);
  const post = fakeResponse();
  routes[0].handler({ method: "POST", headers: {} }, post);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
  assert.equal(post.body, undefined);
  assert.equal(asked.length, 1, "an unsupported method is still admitted first");

  const head = fakeResponse();
  routes[0].handler({ method: "HEAD", headers: {} }, head);
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
});

test("an unauthenticated POST is refused by admission, not told the method is wrong", () => {
  // Otherwise the route would disclose its own existence to an anonymous caller.
  const { ctx, routes } = fakeContext({ admits: () => ({ rejection: 401 }) });
  registerCatalogRoute(ctx, deps);
  const response = fakeResponse();
  routes[0].handler({ method: "POST", headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers.allow, undefined);
});

test("without a web carrier the route is never registered", () => {
  const { ctx, routes, state } = fakeContext({ withWebServer: false });
  registerCatalogRoute(ctx, deps);
  assert.ok(state.attempts > 0, "the route asked for the web server rather than assuming one");
  assert.deepEqual(routes, [], "a host that serves no page never learns the path");
});

test("the route survives the real service lifecycle without injecting connection", async () => {
  // The route reads `connection` per request, so its registration must not depend on the service
  // existing when it mounts. This drives a real Cordis context: a hand-written host cannot prove
  // that the plugin seam behaves the way the product actually loads it.
  const { Context } = await import("@deepseek-ai/cordis");
  const root = new Context();
  const routes: any[] = [];
  let registered = 0;
  const webServer = {
    register: (route: any) => {
      registered += 1;
      routes.push(route);
      return () => {
        routes.splice(routes.indexOf(route), 1);
      };
    },
  };

  // The plugin is loaded the way the composition loads it: one apply, then the services it names
  // arrive and leave independently.
  const app = root.plugin({
    name: "route-under-test",
    apply(ctx: any) {
      registerCatalogRoute(ctx, deps);
    },
  });
  await app.await();

  assert.equal(registered, 0, "a host with no web carrier never learns the path");

  // A carrier without admission: the route registers and refuses, rather than trusting the caller.
  const stopWeb = root.provide("webServer", webServer);
  await Promise.resolve();
  assert.equal(registered, 1, "the route registers once the carrier appears");
  const noProvider = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, noProvider);
  assert.equal(noProvider.statusCode, 503, "a host that cannot admit is refused, not trusted");

  // Provision of admission must start answering on the same registration.
  const stopConnection = root.provide("connection", { admit: () => ({ peer: owner }) });
  const afterMount = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, afterMount);
  assert.equal(afterMount.statusCode, 200, "the same registration starts working when admission appears");
  assert.equal(JSON.parse(afterMount.body!).rowId, "llm-cursor");
  assert.equal(registered, 1, "no remount was needed");

  // Withdrawing admission must fail closed again, still without a second registration.
  stopConnection();
  const afterRemoval = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, afterRemoval);
  assert.equal(afterRemoval.statusCode, 503, "losing admission is not permission");
  assert.equal(registered, 1, "the route never re-registered across the lifecycle");

  stopWeb();
  await root.fiber.dispose();
});
