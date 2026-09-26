import { Effect, Exit, Fiber, Layer, Runtime as EffectRuntime, Scope } from "effect";
import { EventBusLive, type EventBusShape } from "../event/index.js";
import { recordOf, refusal, register, type NexusRuntime } from "./internal.js";

export type { NexusRuntime };

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
  Effect.map(({ runtimeScope, runtime }) => register<R | EventBusShape>({ scope: runtimeScope, runtime }))
);

// A handle this module didn't make is refused as a defect; the effect never starts.
export const run = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A> => {
  const record = recordOf(nexusRuntime);

  return record === undefined
    ? Effect.runPromise(Effect.die(refusal("not a runtime NEXUS made")))
    : EffectRuntime.runPromise(record.runtime as EffectRuntime.Runtime<R>)(effect);
};

export const runFork = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E> => {
  const record = recordOf(nexusRuntime);

  return record === undefined
    ? Effect.runFork(Effect.die(refusal("not a runtime NEXUS made")))
    : EffectRuntime.runFork(record.runtime as EffectRuntime.Runtime<R>)(effect);
};
