# Tasks

## 1. Route admission

- [x] 1.1 Replace the locally declared `ConnectionFence` interface and the `connection` injection in `src/route.ts` with a single `webServer` injection, and verify `grep` finds no remaining `requestRejection` or `ConnectionFence` in `src/`.
- [x] 1.2 Admit through `connection.admit(request)` inside the handler, read per request rather than injected, so one code path serves a host that authorizes before dispatch and one that does not; verify `npm run check` passes.
- [x] 1.3 Refuse a peer whose `principal.kind` is not `owner` with `403`, and refuse an admission carrying no peer, both before any catalog data is written; verify the route tests for the non-owner and no-peer cases pass.
- [x] 1.4 Keep the `GET`/`HEAD`-only branch answering `405` with an `allow` header, and verify the existing method test still passes.

## 2. Catalog payload cleanup

- [x] 2.1 Remove `settingsNs` from `CatalogPayloadArgs`, from `CatalogPayload` and from the route dependencies in `src/route.ts` and `src/index.ts`; verify `npm run check` reports no reference to it in `src/`.
- [x] 2.2 Export the payload version as one constant from `src/catalog-payload.ts`, use it when producing the document, and compare against it in `src/client/index.ts`; verify `grep` finds no second literal `version: 1` in `src/`.
- [x] 2.3 Update `test/route.test.ts` for the removed field and the shared version, and verify `npm test` passes.

## 3. Client failure reporting

- [x] 3.1 Map a failed catalog read to an actionable sentence per status (session absent, permission denied, Host internal failure, route absent), keeping the status in the message; verify the client tests assert each mapping.
- [x] 3.2 Confirm an unrecognized status still produces the generic unavailable message rather than a wrong claim, and verify that case is covered by a test.

## 4. Declared Host floor

- [x] 4.1 Raise `engines.dsh` and the `dsh-llm`, `dsh-credentials` and `dsh-launch-environment` peer dependencies to `>=0.2.2-rc.2`, align their dev dependencies to the same line, and verify `npm install` resolves and `npm run check` passes against it.
- [x] 4.2 Confirm the release guard still passes on the changed files with `npm run check:public`.

## 5. Contract tests

- [x] 5.1 Replace the route test asserting a Host without `connection` never registers the route with contract tests over admission outcomes: an owner peer answers `200` with the catalog, a non-owner peer is refused, and a request admitted with no peer is refused; verify `npm test` passes.
- [x] 5.2 Verify the no-registration path is still covered for a Host that serves no web carrier, so the route stays absent rather than unauthenticated.
- [x] 5.3 Run the full suite and confirm `npm test` and `npm run check` both pass before the change is considered complete.
