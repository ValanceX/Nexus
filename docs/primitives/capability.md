# Capability

> **In plain terms:** Something the *device* may or may not provide, such as haptics, a camera, or local AI. NEXUS works out once, at startup, how each capability is provided (natively, via a fallback, or not at all), so feature code never has to check.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §10. A `Capability`
represents functionality provided by the runtime *environment* — distinct
from `Service`, which is an application dependency. Owned by `Environment`,
a sibling of `Runtime` under `Application` (§4, §14), so capability
resolution can proceed and produce diagnostics independent of whether the
effect runtime has started.

## Responsibility

- Give application code a typed handle to environment-dependent
  functionality (haptics, camera, AI inference, storage, ...) without ever
  writing `if (device.hasHaptics)`.
- Make unsupported capabilities explicit — never a silent no-op the
  application code didn't ask for.

## Data Model

```ts
interface Capability<Shape> {
  readonly id: string;
  readonly tag: Context.Tag<Shape, Shape>;
}

type CapabilitySource = "native" | "browser" | "remote" | "fallback";

type CapabilityResolution<Shape> =
  | { readonly _tag: "Available"; readonly implementation: Shape; readonly source: CapabilitySource }
  | { readonly _tag: "Unavailable"; readonly reason: string };
```

A `Capability<Shape>` looks like a `Service<Shape>` (both wrap a
`Context.Tag`) but resolves differently: a `Service` is provided once, at
`Layer`-build time, by infrastructure the application author chose. A
`Capability` is resolved against the application's `Environment`: the
application author declares it needs `Haptics`, and the environment says
which implementation (or none) backs it. Today the resolutions are supplied
already resolved, in `ApplicationDefinition.environment`, so resolving them
can't fail. Probing the runtime environment to discover them is future work
(§10.1), not part of the current contract.

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

`EnvironmentShape` is the resolved environment: capability id to resolution.
`Application.start` builds it from `ApplicationDefinition.environment` with
`EnvironmentLive`, before the service graph (§10.1), so services and
commands may require it.

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
  hard failure — §10.1's five strategies).
- Resolutions are fixed when the application starts (§10.1) — `resolve`
  reads an already-resolved result every time, which is why its `Effect` is
  cheap and repeatable; nothing is re-discovered per call.
- A capability's `Shape` must be a stable typed interface (§10.2) —
  resolution swaps the *implementation* behind that interface, never the
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
```

## Testing

Covers §20 "Capability": resolution of a supplied implementation (with its
source, including a registered fallback), the `Unavailable` value when
nothing is registered, and the `require`-failure path when nothing can serve
the capability. Discovery by probing is future work, with no tests yet.
