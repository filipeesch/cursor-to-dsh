# Proposal

## Why

The Cursor configuration page cannot list any model. It shows `The model catalog is unavailable right now: catalog route answered 400`, so the whole per-model table — enablement, context tiers, Fast, context windows — is unreachable.

The cause is a host API the plugin no longer owns: `src/route.ts` called `connection.requestRejection()`, which the host has removed from its migration path in favour of route admission, while the plugin declared the method on a local `ConnectionFence` interface so the type check never saw it disappear. The host answers a throwing handler with `400` and an empty body, so the page received a bare status with no catalog and no explanation. Published releases still carry `requestRejection`, which is why the failure depends on the host build rather than on the route itself.

Every release built against this host ships a settings page that cannot configure a single model, and nothing in the type system or the test suite catches the class of breakage.

## What Changes

- Replace the removed `requestRejection` call with `connection.admit(request)`, the one admission seam every published host carries. The route reads the service per request, so a host without it still registers the route and is refused with `503` rather than serving nothing.
- Check the admitted principal in the handler and refuse anything that is not the host owner. The host proves who is calling; only this route decides who its audience is.
- Fail closed when admission cannot establish an identity: no peer, a missing seam, or an admission that throws all refuse the request instead of assuming an owner.
- Report a failed catalog read to the page as an actionable sentence naming the condition, the next step a reader can take, and the status for diagnosis, instead of echoing the bare status code.
- Stop describing the previous catalog once a reload fails, so the page never reports a model count for rows it is no longer showing.
- **BREAKING** for host compatibility: raise the declared host floor to `0.2.2-rc.2`, matching the host line this plugin is verified against. Earlier releases were not tested here and are no longer claimed.
- Remove `settingsNs` from the catalog payload, its arguments and its readers; the row id already identifies the row and nothing ever read the second copy.
- Give the payload version one source of truth instead of a literal repeated in the host producer and the browser reader.
- Replace the route test that asserts a host without `connection` never registers the route, which is no longer a reachable path, with contract tests over admission outcomes: an owner peer, a non-owner peer and a request admitted without a peer.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cursor-settings-ui`: the requirement that the page reads the catalog through an authenticated Host route now states that the route delegates trust fencing and browser-session authentication to the host's route admission, refuses a principal that does not own the host, and answers no catalog data when admission carried no peer; the unavailable-catalog requirement now requires an actionable message keyed by the failure rather than a raw status.

## Impact

- `src/route.ts` (registration, admission, handler), `src/index.ts` (route dependencies), `src/catalog-payload.ts` (payload shape and version), `src/client/index.ts` (failure reporting and version read), `test/route.test.ts` and `test/client.test.ts`, and `package.json` (`engines.dsh`, host peer and dev dependencies).
- The route reads `connection.admit` per request instead of injecting the service, so a host without a connection carrier fails closed rather than leaving the route unregistered.
- No change to the request path, catalog fetching, context tiers, session lifecycle or usage reporting. No configuration field changes, so a stored settings file keeps working unchanged.
