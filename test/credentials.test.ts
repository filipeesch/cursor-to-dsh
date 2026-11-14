import { test } from "node:test";
import assert from "node:assert/strict";

import { CredentialResolver } from "../src/credentials.ts";

test("the credentials service answers first, trimmed", async () => {
  const resolver = new CredentialResolver({
    ref: () => "K",
    credentials: () => ({ resolve: async () => ({ value: "  secret  " }) }),
    environment: () => ({ get: () => ({ value: "env" }) }),
  });
  assert.equal(await resolver.resolve(), "secret");
});

test("the launch environment answers when the service has nothing", async () => {
  const resolver = new CredentialResolver({
    ref: () => "K",
    credentials: () => ({ resolve: async () => undefined }),
    environment: () => ({ get: (name: string) => (name === "K" ? { value: " env " } : undefined) }),
  });
  assert.equal(await resolver.resolve(), "env");
});

test("a failing credentials read falls back to the environment", async () => {
  const resolver = new CredentialResolver({
    ref: () => "K",
    credentials: () => ({ resolve: async () => { throw new Error("unavailable"); } }),
    environment: () => ({ get: () => ({ value: "env" }) }),
  });
  assert.equal(await resolver.resolve(), "env");
});

test("no service, no variable and an empty value all resolve to undefined", async () => {
  const resolver = new CredentialResolver({ ref: () => "K", credentials: () => undefined, environment: () => undefined });
  assert.equal(await resolver.resolve(), undefined);

  const blank = new CredentialResolver({ ref: () => "K", credentials: () => ({ resolve: () => ({ value: "  " }) }), environment: () => ({ get: () => ({ value: "" }) }) });
  assert.equal(await blank.resolve(), undefined);
});
