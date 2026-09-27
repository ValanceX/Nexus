# Capability

> **In plain terms:** Something the application needs from wherever it runs, such as haptics, a camera, or local AI. The application names what it needs; the *platform* it's started on says, once at startup, whether an implementation is there. Feature code never checks the device.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §10. A `Capability` is a
NEXUS identity with a typed contract, for functionality that depends on
the execution environment. It is distinct from `Service`, which is an
application dependency. Which implementation backs a capability is decided
by the **platform** supplied to `Application.start` (see
[application.md](./application.md)), never by the application definition,
and never discovered by NEXUS.

## Responsibility

- Give application code a typed handle to environment-dependent
  functionality (haptics, camera, AI inference, storage, ...) without ever
  writing `if (device.hasHaptics)`.
- Make unsupported capabilities explicit — never a silent no-op the
  application code didn't ask for.
- Name no execution environment. NEXUS doesn't know, and doesn't expose,
  whether an implementation is browser, native, remote or a substitute.

## Meanings (v0.6)

- **Capability:** an identity (`id`) plus a typed contract (`Shape`).
- **Platform:** whatever supplies an application's environment at `start`,
  as a `Layer` providing `Environment`. NEXUS knows no platform by name.
- **Implementation:** a value of `Shape` a platform makes available for an
  `id`.
- **Resolution:** the platform's answer for one `id`, fixed at start:
  `Available` or `Unavailable`. An `id` the platform doesn't mention is
  `Unavailable`.
- **Environment:** the resolved map for one running application.
- **Requirement (v0.7):** a declared claim that some unit of the
  application can't work unless a capability resolves `Available`.
- **Provision statement (v0.7):** a platform's plain-data claim about which
  capability ids every start of it resolves `Available`, and which it
  doesn't.

## Data Model

```ts
interface Capability<Shape> {
  readonly id: string;
  // plus a type-only phantom member that carries Shape; never assigned
}

type CapabilityResolution<Shape> =
  | { readonly _tag: "Available"; readonly implementation: Shape }
  | { readonly _tag: "Unavailable"; readonly reason: string };
```

A capability's only runtime field is its `id`. The phantom member exists
only in the type, so that `resolve` and `require` infer `Shape`, and so
that a `Capability<A>` isn't assignable to a `Capability<B>`.

A `Capability` is not an Effect service. A `Service` is provided at
`Layer`-build time by infrastructure the application author chose. A
`Capability` is looked up by `id` in the application's `Environment`, which
its platform supplied. There is no second way to supply one.

## Supplying capabilities (for platforms)

A platform is a `Layer.Layer<EnvironmentShape, unknown, never>`, passed as
`Application.start(app, { platform })`. It can supply implementations in
two ways:

- **Host-owned values:** `Capability.EnvironmentLive(map)`. The host created
  the implementations, owns their lifetime, and may share them between
  applications. NEXUS never releases them.
- **Application-scoped resources:** a scoped layer that builds the map, for
  example `Layer.scoped(Capability.Environment, Effect.acquireRelease(…))`.
  The platform Layer is provided to the application-owned runtime scope, so
  these are acquired before, and released after, every application
  resource. Each `start` acquires its own.

Application code sees the same `CapabilityResolution` either way, and can't
tell which was used. An implementation that acquires something lazily,
outside its platform layer's scope, is effectively host-owned: NEXUS won't
release it.

## Requirements and provisions (v0.7)

The v0.7 capability model relates what an application **requires** to what
a platform **provides**, before anything runs, without changing how
anything runs. It adds no API. It gives existing pieces an exact meaning
(v0.7 outline D44–D47, C19–C23):

```text
capability contract   Capability.define<Shape>(id)          owned by whoever defines the contract
        │ requirement (claim)             │ provision (claim)
        ▼                                 ▼
Semantic.Declaration               Semantic.TargetProfile  ── Semantic.analyze ──▶ supported / opaque / incompatible
                                          ┊ conformance: tested, never derived
                                          ▼
                                   Application.Platform (Layer) ── start ──▶ Environment ──▶ resolve / require
```

These are five different things. The shared `id` is the identity of the
**contract**, and it doesn't make any of them the same abstraction:

- **Capability contract.** `id` plus `Shape`. The application, or a shared
  contract module, defines it. Prefer an application-facing contract
  (`AssetStore`) to an implementation (`NodeFileSystem`).
- **Requirement.** A [semantic declaration](../semantic.md) whose
  requirements name `SomeCapability.id`. It means **necessity**, not use:
  code that calls `resolve` and handles `Unavailable` with a fallback
  doesn't require the capability, and shouldn't declare it. Code that can't
  work without it (typically `require` with no fallback) does. Granularity is
  yours: one declaration per command, or one for the whole application.
- **Platform provision statement.** A `Semantic.TargetProfile` the platform
  author writes alongside the platform's `Layer`. Its identifiers are
  capability ids, verbatim:

  | Entry | The platform promises that, on every start… |
  |---|---|
  | `provided` | this capability resolves `Available` |
  | `notProvided` | this capability is not `Available` through this platform's `Environment` |
  | neither | nothing: undecided. Use this for anything conditional, such as permissions, optional hardware, remote state or user configuration |

  `notProvided` is a promise, not "no implementation happens to exist
  today". The statement is never passed to `Application.start`, and NEXUS
  never derives it from a `Layer` or a running `Environment`.
- **Runtime `Environment`.** The fact for one start, built by the platform
  `Layer`. `resolve` and `require` read only this.
- **PORT target capability.** What a rendering target can realize. It isn't
  a capability id, and it isn't part of this model.

**A verdict is not enforcement.** An *incompatible* verdict doesn't stop an
application from starting on that platform, and a *supported* one doesn't
make a capability `Available`. The application sees exactly what the
platform's `Layer` supplies. Deciding what to do with a verdict is the
caller's job.

**Conformance is the platform's obligation.** A platform that publishes a
statement must make every start agree with it: `provided` ids resolve
`Available`, and `notProvided` ids resolve `Unavailable`. NEXUS doesn't
check this at runtime. Platforms prove it in their own tests. NEXUS's own
test tooling (`tests/platform/conformance.ts`) shows how, and it is not
part of the package.

**Identity.** A capability *is* its `id` string, at runtime and in analysis.
`Shape` is never compared. Two contracts with the same `id` share an
implementation and share verdicts, so qualify ids by their owner (for
example `"acme.asset-store"`). There is no registry, and NEXUS defines no
ids.

## Composing platforms

NEXUS doesn't compose platforms: `start` takes exactly one `Platform`.
Assembling several contributions into one `Layer` that builds one
`Environment` is the platform author's or host's job, including choosing
what happens when two contributions supply the same id.

Beware `Layer.merge` of two `Environment` layers. It doesn't combine their
maps: the later `Environment` replaces the earlier one, so every id only the
earlier one supplied resolves `Unavailable`, with no error.
`tests/capability-characterization.test.ts` pins this Effect behavior.
Build one map instead.

## API

```ts
namespace Capability {
  function define<Shape>(id: string): Capability<Shape>;
  function resolve<Shape>(capability: Capability<Shape>): Effect.Effect<CapabilityResolution<Shape>, never, EnvironmentShape>;
  function require<Shape>(capability: Capability<Shape>): Effect.Effect<Shape, CapabilityUnavailableError, EnvironmentShape>;
}

interface EnvironmentShape {
  readonly resolutions: ReadonlyMap<string, CapabilityResolution<unknown>>;
}

const Environment: Context.Tag<EnvironmentShape, EnvironmentShape>;
function EnvironmentLive(resolutions: ReadonlyMap<string, CapabilityResolution<unknown>>): Layer.Layer<EnvironmentShape>;
```

`EnvironmentShape` is the resolved environment: capability id to
resolution. `Application.start` builds the platform before the application's
service graph, so services and commands may require it. With no platform,
the environment is empty.

`resolve` never fails — "unavailable" is a value (`CapabilityResolution`'s
`Unavailable` branch), not an error, because the whole point of §10 is
that unsupported capabilities need an explicit *strategy*, and a value the
caller must pattern-match on forces that decision at the call site.
`require` is the convenience for the common case where the application has
already decided "no fallback, this feature just doesn't work without it" —
it turns `Unavailable` into a typed failure so the caller doesn't have to
re-derive that decision every time.

## Errors

```ts
type CapabilityUnavailableError =
  | { readonly _tag: "CapabilityUnavailableError"; readonly id: string; readonly reason: string };
```

Only produced by `require`, and only by converting an already-known
`Unavailable` resolution — `Capability` does not introduce any error case
beyond "this specific capability isn't here."

## Rules

- Application code must never branch on device/platform identity
  (`isMobile`, `hasHaptics`) — it may only branch on a
  `CapabilityResolution`'s `_tag`, which is the one sanctioned way to
  express "what does the app do if this isn't available" (fallback, no-op,
  alternative implementation, degraded representation, or `require`'s
  hard failure). A substitute implementation a platform supplies is simply
  `Available`.
- Resolutions are fixed when the application starts — `resolve` reads an
  already-resolved result every time, which is why its `Effect` is cheap
  and repeatable; nothing is re-discovered per call.
- A capability's `Shape` must be a stable typed interface (§10.2) — a
  platform swaps the *implementation* behind that interface, never the
  interface itself.

## Example

```ts
interface HapticsShape {
  readonly vibrate: (pattern: HapticPattern) => Effect.Effect<void, HapticsError>;
}

const Haptics = Capability.define<HapticsShape>("haptics");

const notifyUser = Effect.gen(function* () {
  const resolution = yield* Capability.resolve(Haptics);

  if (resolution._tag === "Available") {
    yield* resolution.implementation.vibrate({ durationMs: 100 });
  } // else: degrade to a visual notification, chosen explicitly here.
});

// The host, not the application, chooses what backs Haptics:
Application.start(app, {
  platform: Capability.EnvironmentLive(new Map([[Haptics.id, { _tag: "Available", implementation: deviceHaptics }]])),
});
```

## Testing

Covers §20 "Capability": resolution of a supplied implementation, a
substitute implementation being just `Available`, the `Unavailable` value
when nothing is registered, and the `require`-failure path.
`tests/platform.test.ts` covers supply through a platform: host-owned
values, application-scoped resources and their lifetime, the absence of any
source field, the `id`-only runtime shape and `Shape` inference. There is
no discovery, and none is planned. `tests/capability-model.test.ts` covers
the v0.7 platform binding and the independence of analysis from resolution;
`tests/platform-conformance.test.ts` covers the test-only conformance
helper; `tests/capability-characterization.test.ts` pins `Environment` merge
and id-collision behavior.
