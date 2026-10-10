import type { EventBusShape } from "../event/index.js";

import { Duration, Effect, Fiber, Layer, Runtime as EffectRuntime, Scope } from "effect";

import { admitting, isolated, makeLifecycle, recordOf, refusal, register, terminateLifecycle, tracked, type NexusRuntime } from "./internal.js";
import { EventBus, makeBus } from "../event/internal.js";

export type { NexusRuntime };
export { isRefusal, Refusal, refusalOf } from "./internal.js";
export type { RefusalCode } from "./internal.js";

/**
 * How a runtime ends. `grace` is how long termination waits for the effects started with `run` and `runFork` to finish on their own, after new work is
 * refused, before it interrupts what is left and waits for each to exit. The default, `0`, interrupts at once: an effect never outlives the resources it uses.
 * `Infinity` waits for every effect, however long it takes.
 */
export interface ShutdownOptions {
  readonly grace?: Duration.DurationInput;
}

export interface RuntimeOptions {
  readonly shutdown?: ShutdownOptions;
}

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
export const make = <R>(layer: Layer.Layer<R, unknown, EventBusShape>, options?: RuntimeOptions): Effect.Effect<NexusRuntime<R | EventBusShape>, RuntimeInitError, Scope.Scope> => Effect.Do.pipe(
  Effect.bind("bus", () => makeBus),
  Effect.bind("lifecycle", ({ bus }) => makeLifecycle(bus, Duration.decode(options?.shutdown?.grace ?? 0))),
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
const runtimeFor = <R>(nexusRuntime: NexusRuntime<R>): { readonly runtime: EffectRuntime.Runtime<R>; readonly track: <A, E>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> } | Error => {
  const record = recordOf(nexusRuntime);

  if (record === undefined) {
    return refusal("not-a-runtime");
  }

  return admitting(record.lifecycle)
    ? { runtime: record.runtime as EffectRuntime.Runtime<R>, track: (effect) => tracked(record.lifecycle, effect) }
    : refusal("terminating");
};

export const run = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A> => {
  const admitted = runtimeFor(nexusRuntime);

  return admitted instanceof Error ? Effect.runPromise(Effect.die(admitted)) : EffectRuntime.runPromise(admitted.runtime)(admitted.track(effect));
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
  const admitted = runtimeFor(nexusRuntime);

  if (admitted instanceof Error) {
    return Effect.runFork(Effect.die(admitted));
  }

  const execution = EffectRuntime.runFork(admitted.runtime)(admitted.track(effect));

  return Effect.runFork(Fiber.await(execution).pipe(
    Effect.onInterrupt(() => Fiber.interrupt(execution)),
    Effect.flatten
  ));
};
