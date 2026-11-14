import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG_PATH } from "../src/constants.ts";
import { payloadFor, registerCatalogRoute, type CatalogRouteDeps } from "../src/route.ts";

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
  settingsNs: "llm-cursor",
  models: () => models as any,
  publishedWindow: (modelId: string) => (modelId === "deepseek" ? 1_048_576 : undefined),
  acceptedTier: (modelId: string) => (modelId === "claude" ? "300k" : undefined),
  knownContext: () => ({ enabled: true, fetchedAt: 1_700_000_000_000 }),
};

test("the payload carries the row identity and the catalog shape the page renders", () => {
  const payload = payloadFor(deps);
  assert.equal(payload.version, 1);
  assert.equal(payload.provider, "cursor");
  assert.equal(payload.rowId, "llm-cursor");
  assert.equal(payload.settingsNs, "llm-cursor");
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

function fakeContext(options: { fence?: (request: any) => 401 | 403 | undefined } = {}): { ctx: any; routes: any[] } {
  const routes: any[] = [];
  const ctx: any = {
    inject: (dependencies: string[], callback: (child: any) => void) => {
      const child: any = { effect: (fn: () => any) => fn() };
      if (dependencies.includes("connection")) {
        // A host without the connection service never reaches the nested registration.
        if (options.fence === undefined) return;
        child.connection = { requestRejection: options.fence };
      }
      if (dependencies.includes("webServer")) {
        child.webServer = {
          register: (route: any) => {
            routes.push(route);
            return () => {};
          },
        };
      }
      callback(child);
    },
  };
  return { ctx, routes };
}

test("the route registers one exact path and answers authenticated JSON", () => {
  const { ctx, routes } = fakeContext({ fence: () => undefined });
  registerCatalogRoute(ctx, deps);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, "exact");
  assert.equal(routes[0].path, CATALOG_PATH);

  const response = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(response.body!).rowId, "llm-cursor");
});

test("an unauthenticated request is refused before any catalog data", () => {
  const { ctx, routes } = fakeContext({ fence: () => 401 });
  registerCatalogRoute(ctx, deps);
  const response = fakeResponse();
  routes[0].handler({ method: "GET", headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body, undefined);
});

test("a host with no connection service never registers the route", () => {
  const { ctx, routes } = fakeContext();
  registerCatalogRoute(ctx, deps);
  assert.deepEqual(routes, [], "without the fence service the route is absent rather than unauthenticated");
});

test("only GET and HEAD are answered", () => {
  const { ctx, routes } = fakeContext({ fence: () => undefined });
  registerCatalogRoute(ctx, deps);
  const post = fakeResponse();
  routes[0].handler({ method: "POST", headers: {} }, post);
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, "GET, HEAD");

  const head = fakeResponse();
  routes[0].handler({ method: "HEAD", headers: {} }, head);
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
});

test("without a web carrier the route is never registered", () => {
  const routes: any[] = [];
  const ctx: any = { inject: () => {} };
  registerCatalogRoute(ctx, deps);
  assert.deepEqual(routes, []);
});
