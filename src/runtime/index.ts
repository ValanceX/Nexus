import { Effect, Exit, Fiber, Layer, Runtime as EffectRuntime, Scope } from "effect";
import { EventBusLive, type EventBusShape } from "../event/index.js";

export interface NexusRuntime<R> {
  readonly scope: Scope.CloseableScope;
  readonly runtime: EffectRuntime.Runtime<R>;
}

export type RuntimeInitError = {
  readonly _tag: "LayerBuildFailed";
  readonly cause: unknown;
};

/**
 * Builds a runtime from `layer`, with the application's own event bus as an
 * ambient layer. `EventBusLive` is *provide-merged* into `layer`: its output
 * satisfies an `EventBusShape` requirement declared by `layer` itself, and it
 * also stays in the final context, so `Event.publish`/`Event.subscribe` can be
 * run directly through `run`/`runFork` against the returned runtime.
 */
export const make = <R>(layer: Layer.Layer<R, unknown, EventBusShape>): Effect.Effect<NexusRuntime<R | EventBusShape>, RuntimeInitError, Scope.Scope> => Effect.Do.pipe(
  Effect.bind("runtimeScope", () => Scope.make()),
  // Tied to the *caller's* scope, so an interrupted/failed caller still closes
  // the runtime scope rather than leaking every layer it already built.
  Effect.tap(({ runtimeScope }) => Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.succeed(undefined)))),
  // The built Context feeds straight into Effect.runtime and is deliberately
  // NOT stored on NexusRuntime — runtime.md forbids exposing it for ambient
  // lookup outside Service/Capability resolution.
  Effect.bind("runtime", ({ runtimeScope }) => Layer.buildWithScope(Layer.provideMerge(layer, EventBusLive), runtimeScope).pipe(
    Effect.mapError((cause): RuntimeInitError => ({ _tag: "LayerBuildFailed", cause })),
    Effect.andThen((context) => Effect.runtime<R | EventBusShape>().pipe(Effect.provide(context)))
  )),
  Effect.map(({ runtimeScope, runtime }) => ({ scope: runtimeScope, runtime }))
);

export const run = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A> => EffectRuntime.runPromise(nexusRuntime.runtime)(effect);

export const runFork = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E> => EffectRuntime.runFork(nexusRuntime.runtime)(effect);

export const shutdown = <R>(nexusRuntime: NexusRuntime<R>): Effect.Effect<void> => Scope.close(nexusRuntime.scope, Exit.succeed(undefined));
