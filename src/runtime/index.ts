import type { EventBusShape } from "../event/index.js";

import { Effect, Fiber, Layer, Runtime as EffectRuntime, Scope } from "effect";

import { admitting, isolated, makeLifecycle, recordOf, refusal, register, terminateLifecycle, type NexusRuntime } from "./internal.js";
import { EventBus, makeBus } from "../event/internal.js";

export type { NexusRuntime };
export { isRefusal, Refusal } from "./internal.js";
export type { RefusalCode } from "./internal.js";

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
  //
  // Built, and the runtime captured, in the application's own fiber (I44–I47):
  // it starts with the caller's FiberRefs, and the layers' FiberRef writes
  // (Layer.setClock, …) stay in it, so the caller never sees them.
  Effect.bind("runtime", ({ bus, lifecycle }) => isolated(Layer.buildWithScope(Layer.provideMerge(layer, Layer.succeed(EventBus, bus.shape)), lifecycle.scope).pipe(
    Effect.mapError((cause): RuntimeInitError => ({ _tag: "LayerBuildFailed", cause })),
    Effect.andThen((context) => Effect.runtime<R | EventBusShape>().pipe(Effect.provide(context)))
  ))),
  Effect.map(({ lifecycle, runtime }) => register<R | EventBusShape>({ runtime, lifecycle }))
);

// New work is admitted only until termination is requested, the same boundary
// `admit` uses. A handle NEXUS didn't make, or one whose termination has been
// requested, is refused as a defect, and the effect never starts (Q1).
const runtimeFor = <R>(nexusRuntime: NexusRuntime<R>): EffectRuntime.Runtime<R> | Error => {
  const record = recordOf(nexusRuntime);

  if (record === undefined) {
    return refusal("not-a-runtime");
  }

  return admitting(record.lifecycle) ? record.runtime as EffectRuntime.Runtime<R> : refusal("terminating");
};

export const run = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A> => {
  const runtime = runtimeFor(nexusRuntime);

  return runtime instanceof Error ? Effect.runPromise(Effect.die(runtime)) : EffectRuntime.runPromise(runtime)(effect);
};

/**
 * The fiber returned is an execution handle NEXUS controls, never the fiber the
 * effect runs in (v0.9 C32, J1a). The effect runs in the application's own fiber,
 * with the application's FiberRefs; the handle observes it with `Fiber.await`,
 * never `Fiber.join`, and runs on Effect's default runtime, so it holds none of
 * those FiberRefs, and `join`, `Effect.fromFiber` or `inheritAll` on it import
 * nothing of the application's into the caller (I44). Results, typed failures and
 * defects pass through unchanged. Interrupting the handle interrupts the effect,
 * and waits for it to finish.
 */
export const runFork = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E> => {
  const runtime = runtimeFor(nexusRuntime);

  if (runtime instanceof Error) {
    return Effect.runFork(Effect.die(runtime));
  }

  const execution = EffectRuntime.runFork(runtime)(effect);

  return Effect.runFork(Fiber.await(execution).pipe(
    Effect.onInterrupt(() => Fiber.interrupt(execution)),
    Effect.flatten
  ));
};
