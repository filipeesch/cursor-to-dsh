# Design

## Context

See `proposal.md` - Why for the defect and its trigger.

The plugin's browser-facing route is its only HTTP surface. Until now it fenced that route itself, through a locally declared `ConnectionFence` interface that named `requestRejection()`. Recent Host sources have moved trust fencing and credential verification into route admission, which runs before dispatch: a registration resolves an `auth` policy, the composition answers `webserver/authorize`, and the handler receives the admitted peer. That generation no longer carries the old method at all. The plugin declared the method itself rather than importing the Host type, so the compiler had nothing to compare against and the defect surfaced only at runtime, on the Host build that no longer answered it.

The two host generations this plugin can meet:

- **Published releases (`0.2.1-rc.2` onward).** A route handler is called as `handler(req, res)`. The `connection` service exposes `admit(request)`, which applies the Host/Origin fence and the browser-session check and answers either `{ peer }` with `principal.kind === "owner"` or `{ rejection }` with `401`, `403` or `503`. `requestRejection` also exists but is gone from the migration guide.
- **Recent host sources.** The registration resolves an `auth` policy, the composition answers `webserver/authorize` before dispatch, and the handler receives the admitted peer as a third argument. No published release does this yet.

Both leave `connection.admit` as the one seam that behaves identically. A handler that throws is answered with `400` and no body on either generation, which is how the original defect surfaced.

The peer carries `principal`, a merge-extensible identity. Only `owner` - the local user who owns the Host - holds business meaning here; other compositions declare their own kinds (a live-share reader is one), so a non-owner peer is a real caller, not a hypothetical.

## Goals / Non-Goals

**Goals:**

- Make the catalog route work on the Host the plugin actually runs on, without the plugin reproducing the Host's admission.
- Keep the route's answers restricted to the Host owner.
- Make a failed catalog read legible to the reader of the page.
- Leave the plugin's request path untouched.

**Non-Goals:**

- Changing the route's path, its methods, or the catalog document's model content.
- Adding a second HTTP surface, or moving the catalog behind a Remote namespace.
- Changing any configuration field, so no stored settings file needs migrating.
- Reducing the payload version or otherwise invalidating a document already served.

## Decisions

### Admit through `connection.admit()` inside the handler

Call `connection.admit(request)` from the handler, read the peer it returns, and stop calling `requestRejection`. Read the service per request rather than injecting it, so a host that lacks it still registers the route and is refused with `503` instead of serving nothing.

**Why:** `admit` is the only admission seam every published host carries. Two host generations exist in practice. Recent host sources resolve an `auth` policy and answer `webserver/authorize` before dispatch, passing the peer to the handler as a third argument; no published release does either. Every published release from `0.2.1-rc.2` dispatches `handler(req, res)` and exposes `admit`, which applies the same Host/Origin fence and the same browser-session check the newer admission applies before dispatch. Calling `admit` therefore works on both generations with one code path.

A design that declared `auth` and read a third handler argument was tried first and rejected after review: on every published release the argument is absent, so the owner check saw no peer and refused the owner with `403`. Relying on the host generation that is not released yet would have replaced a visible `400` with a silent `403` on exactly the hosts the floor admitted.

**Alternatives considered:**

- *Declare `auth: 'required'` and read the peer from the handler's third argument.* Works only against unreleased host sources; every published release answers the owner with `403`. Rejected.
- *Keep `requestRejection`.* It still exists in published releases, but the Host migration guide removes it, so the plugin would break on the next host whatever it did about this route. Rejected as a dead end.
- *Bypass admission and trust a header.* No: identity must come from the host, never from the request.

### Check the owner in the handler

After admission, refuse any peer whose `principal.kind` is not `owner` with `403`, and refuse a request that carries no peer at all.

**Why:** `required` admission guarantees *a* live peer, not the *right* one. `PrincipalMap` is merge-extensible and a share reader is admitted as its own kind, so without this check any admitted caller in such a composition would read the owner catalog. The check costs one comparison and states the actual audience.

**Alternatives considered:**

- *Rely on admission alone.* Cheaper, but it makes the route's audience an accident of which credential providers happen to be mounted.
- *Import the Host route types to get this for free.* The types would not add an owner check - admission permits any admitted peer - so the check is ours to write either way.

### Keep the manual method check

The handler keeps answering `405` with an `Allow` header for methods other than `GET` and `HEAD`.

**Why:** it keeps the migration to admission isolated from a change of route shape, so a regression in one is not confused with a regression in the other. The behavior the page depends on is already covered by the existing scenarios.

**Alternatives considered:**

- *Switch to `resource`.* The Host answers non-read methods for a `resource` registration itself, which would delete this branch. Deferred: it changes the response construction and its HEAD handling alongside the admission migration.
### Report the failure as a condition, not a status

The browser half maps a failed read to a sentence naming the condition - session absent, permission denied, Host internal failure, route absent - while keeping the status in the message for diagnosis.

The Host answers a throwing handler with a body-less `400`, so the status alone cannot distinguish a broken plugin from a build that predates the route. The reader needs the actionable part; a maintainer needs the number.

**Alternatives considered:**

- *Have the route answer a JSON error code.* More precise, but it widens the route contract and cannot help a handler that never runs.
- *Leave the message as it is.* It is how this defect stayed opaque.

### One source for the payload version

Export the version from the catalog document module and have the browser half compare against it.

The producer wrote a literal and the reader wrote the same literal in a different module, so the pair can drift without any test noticing.

### Raise the declared Host floor

Move `engines.dsh` and the Host peer dependencies to `>=0.2.2-rc.2`, and align the dev dependencies so the type check compiles against the same contract.

The route relies on `connection.admit` returning an owner identity for the browser session. The floor names the host line this change was verified against rather than the earliest line that might work: `0.2.1-rc.2` also admits an owner peer, but it was not the line tested here, and claiming untested releases is how the previous floor went wrong.

**Consequence:** this is a breaking change for anyone pinned below that floor, which is why the proposal marks it so.

## Risks / Trade-offs

- **A Host without `connection` now answers `503` instead of not registering the route.** -> Failing closed is the only safe answer when the identity cannot be established, and it is testable. A test asserts the route still asks for a carrier and registers nothing without one.
- **The owner check could refuse a caller the Host considers legitimate.** -> The only principal with business meaning in this composition is `owner`, and the browser cookie resolves to exactly that. If another composition needs a different reader, that is a deliberate change with its own requirement.
- **Calling `admit` repeats a check a newer Host already performed.** -> On a newer Host the second check is cheap and answers from the same facts; on a published Host it is the only check there is. One path for both costs less than two paths for one.
- **`admit` could disappear in a later Host line, as `requestRejection` did.** -> The method is read as data (`admit?`) and a missing seam fails closed with `503` instead of throwing into a `400`. A contract test pins that behaviour.
- **Raising the floor strands an older Host that might have worked.** -> Intended and marked breaking. The floor names the line this change was verified against; an earlier release could plausibly work, and widening support later is a verified change of its own rather than an unverified claim now.
- **The status-to-sentence mapping can mislabel an unexpected status.** -> The mapping keeps the status visible, and an unrecognized status still produces the generic unavailable message and a next step rather than a wrong cause.

## Migration Plan

No data migration: no configuration field changes, and the payload shape only loses a field no reader used while keeping its version.

A user upgrading the plugin on a Host at or above the new floor sees the model table return. A Host below the floor is refused at install time by the declared engine.

Rollback is a version downgrade to the previous release, which restores the previous behavior - the page failing on a modern Host - so rollback is only appropriate alongside a Host downgrade.
