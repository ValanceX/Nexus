import type { EventBusShape } from "../event/index.js";

import { Effect, Fiber, Layer, Runtime as EffectRuntime, Scope } from "effect";

import { EventBus, makeBus } from "../event/internal.js";
import { admitting, makeLifecycle, recordOf, refusal, register, terminateLifecycle, type NexusRuntime } from "./internal.js";

export type { NexusRuntime };

export type RuntimeInitError = {
  readonly _tag: "LayerBuildFailed";
  readonly cause: unknown;
};

/**
 * Builds a runtime from `layer`, with its own event bus as an ambient layer: the
 * bus is *provide-merged* into `layer`, so it satisfies an `EventBusShape`
 * requirement `layer` declares, and stays in the final context for
 * `Event.publish`/`Event.subscribe` run through `run`/`runFork`.
 *
 * The runtime is owned by the caller's Scope, and ends when it closes: new work
 * is refused, the bus closes, then every resource is released (runtime.md).
 */
export const make = <R>(layer: Layer.Layer<R, unknown, EventBusShape>): Effect.Effect<NexusRuntime<R | EventBusShape>, RuntimeInitError, Scope.Scope> => Effect.Do.pipe(
  Effect.bind("bus", () => makeBus),
  Effect.bind("lifecycle", ({ bus }) => makeLifecycle(bus)),
  // Tied to the *caller's* scope, so an interrupted/failed caller still
  // terminates the runtime rather than leaking every layer it already built.
  Effect.tap(({ lifecycle }) => Effect.addFinalizer(() => terminateLifecycle(lifecycle))),
  // The built Context feeds straight into Effect.runtime, which is kept in the
  // private registry, never on the handle (N3).
  Effect.bind("runtime", ({ bus, lifecycle }) => Layer.buildWithScope(Layer.provideMerge(layer, Layer.succeed(EventBus, bus.shape)), lifecycle.scope).pipe(
    Effect.mapError((cause): RuntimeInitError => ({ _tag: "LayerBuildFailed", cause })),
    Effect.andThen((context) => Effect.runtime<R | EventBusShape>().pipe(Effect.provide(context)))
  )),
  Effect.map(({ lifecycle, runtime }) => register<R | EventBusShape>({ runtime, lifecycle }))
);

// New work is admitted only until termination is requested, the same boundary
// `admit` uses. A handle NEXUS didn't make, or one whose termination has been
// requested, is refused as a defect, and the effect never starts (Q1).
const runtimeFor = <R>(nexusRuntime: NexusRuntime<R>): EffectRuntime.Runtime<R> | Error => {
  const record = recordOf(nexusRuntime);

  if (record === undefined) {
    return refusal("not a runtime NEXUS made");
  }

  return admitting(record.lifecycle) ? record.runtime as EffectRuntime.Runtime<R> : refusal("the runtime has begun terminating");
};

export const run = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A> => {
  const runtime = runtimeFor(nexusRuntime);

  return runtime instanceof Error ? Effect.runPromise(Effect.die(runtime)) : EffectRuntime.runPromise(runtime)(effect);
};

export const runFork = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E> => {
  const runtime = runtimeFor(nexusRuntime);

  return runtime instanceof Error ? Effect.runFork(Effect.die(runtime)) : EffectRuntime.runFork(runtime)(effect);
};
