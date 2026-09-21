# Capability

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
`Capability` is resolved once, at `Environment` startup, by *probing the
runtime environment* — the application author declares it needs `Haptics`;
which implementation (or none) backs it is discovered, not chosen.

## API

```ts
namespace Capability {
  function define<Shape>(id: string): Capability<Shape>;
  function resolve<Shape>(capability: Capability<Shape>): Effect.Effect<CapabilityResolution<Shape>, never, Environment>;
  function require<Shape>(capability: Capability<Shape>): Effect.Effect<Shape, CapabilityUnavailableError, Environment>;
}
```

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
- Resolution happens once, at `Environment` startup (§10.1) — a
  `Capability` does not re-probe the environment on every `resolve` call;
  `resolve`'s `Effect` is cheap/repeatable specifically because it's
  reading an already-resolved result, not re-discovering it.
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

Covers §20 "Capability": discovery (the right source is picked when
multiple could apply), implementation selection, fallback strategies
actually engaging when the primary is unavailable, and the `Unavailable`/
`require`-failure path when nothing can serve the capability.
