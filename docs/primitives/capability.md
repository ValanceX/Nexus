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
no discovery, and none is planned.
