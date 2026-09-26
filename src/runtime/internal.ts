// Runtime internals. Not re-exported by src/index.ts: nothing here is public.
import type { Bus } from "../event/internal.js";

import { Deferred, Effect, Exit, Runtime as EffectRuntime, Scope } from "effect";

declare const NexusRuntimeTypeId: unique symbol;

/**
 * An opaque execution handle (N3). It carries no readable member: the Effect
 * runtime, the service Context and the runtime's Scope stay in the module-private
 * registry below, reachable only by the functions that execute through a handle.
 * Contravariant in R, like Effect's own Runtime<in R>, so call sites infer as before.
 */
export interface NexusRuntime<in R> {
  readonly [NexusRuntimeTypeId]: (_: R) => void;
}

/**
 * What a runtime's termination needs. It exists before the service graph is
 * built, so a runtime whose build fails still terminates through it.
 */
export interface Lifecycle {
  readonly scope: Scope.CloseableScope;
  readonly bus: Bus;
  /** Orders admission (`admit`) against the start of termination. */
  readonly admission: Effect.Semaphore;
  /** Completed the moment termination begins: admission has stopped. */
  readonly begun: Deferred.Deferred<void>;
  readonly terminated: Deferred.Deferred<void>;
  readonly state: { accepting: boolean; claimed: boolean };
  /**
   * An owner's lifecycle transitions, run by whichever caller performs the
   * termination: `onBegin` atomically with the end of admission, `onEnd` after
   * every resource is released and before any caller returns. An application
   * uses them for `Stopping` and `Stopped`.
   */
  hooks: { readonly onBegin: Effect.Effect<void>; readonly onEnd: Effect.Effect<void> };
}

export interface RuntimeRecord {
  readonly runtime: EffectRuntime.Runtime<never>;
  readonly lifecycle: Lifecycle;
}

const records = new WeakMap<object, RuntimeRecord>();

export const register = <R>(record: RuntimeRecord): NexusRuntime<R> => {
  const handle: object = Object.freeze(Object.create(null));

  records.set(handle, record);

  return handle as NexusRuntime<R>;
};

export const recordOf = (handle: NexusRuntime<never>): RuntimeRecord | undefined => records.get(handle);

export const scopeOf = (handle: NexusRuntime<never>): Scope.Scope | undefined => recordOf(handle)?.lifecycle.scope;

/** The one defect value for lifecycle and handle misuse. Deliberately not a public error type. */
export const refusal = (reason: string): Error => new Error(`NEXUS: ${reason}`);

export const makeLifecycle = (bus: Bus): Effect.Effect<Lifecycle> => Effect.Do.pipe(
  Effect.bind("scope", () => Scope.make()),
  Effect.bind("admission", () => Effect.makeSemaphore(1)),
  Effect.bind("begun", () => Deferred.make<void>()),
  Effect.bind("terminated", () => Deferred.make<void>()),
  Effect.map(({ scope, admission, begun, terminated }): Lifecycle => ({
    scope, bus, admission, begun, terminated,
    state: { accepting: true, claimed: false },
    hooks: { onBegin: Effect.void, onEnd: Effect.void },
  }))
);

/** Gives a runtime's owner its lifecycle transitions (see `Lifecycle.hooks`). */
export const setHooks = (handle: NexusRuntime<never>, hooks: Lifecycle["hooks"]): void => {
  const record = recordOf(handle);

  if (record !== undefined) {
    record.lifecycle.hooks = hooks;
  }
};

/**
 * Terminates a runtime, once. The first caller claims the termination, then:
 * 1. waits for work already admitted (it holds the admission permit) to finish;
 * 2. under that permit, in one step: runs `onBegin` (an application's
 *    `Running → Stopping`) and stops admitting. This is the moment termination
 *    *begins*: no new work starts after it;
 * 3. closes the bus, so no event is delivered after this (D4);
 * 4. closes the scope, releasing every resource;
 * 5. runs `onEnd` (an application's `Stopped`).
 * Every other caller waits until all of that is done. Uninterruptible, so a
 * termination that has been claimed always completes.
 */
export const terminateLifecycle = (lifecycle: Lifecycle): Effect.Effect<void> => Effect.uninterruptible(Effect.suspend(() => {
  if (lifecycle.state.claimed) {
    return Deferred.await(lifecycle.terminated);
  }

  lifecycle.state.claimed = true;

  return Effect.Do.pipe(
    Effect.andThen(lifecycle.admission.withPermits(1)(lifecycle.hooks.onBegin.pipe(Effect.andThen(Effect.sync(() => { lifecycle.state.accepting = false; }))))),
    Effect.andThen(Deferred.succeed(lifecycle.begun, undefined)),
    Effect.andThen(lifecycle.bus.close),
    Effect.andThen(Scope.close(lifecycle.scope, Exit.void)),
    Effect.andThen(lifecycle.hooks.onEnd),
    Effect.andThen(Deferred.succeed(lifecycle.terminated, undefined)),
    Effect.asVoid
  );
}));

export const terminate = (handle: NexusRuntime<never>): Effect.Effect<void> => {
  const record = recordOf(handle);

  return record === undefined ? Effect.void : terminateLifecycle(record.lifecycle);
};

/**
 * Runs `effect` only if the runtime is still admitting work, and otherwise dies
 * with the refusal. Admission and the start of termination are totally ordered:
 * `effect` either runs to completion before termination begins, or doesn't run.
 *
 * A request made once termination has been claimed but hasn't yet begun (it's
 * waiting for work already admitted) doesn't compete with it for the permit,
 * which the permit's non-FIFO wake-up would otherwise allow: it waits until
 * termination begins, then is refused.
 */
export const admit = <A, E>(handle: NexusRuntime<never>, effect: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const record = recordOf(handle);

  if (record === undefined) {
    return Effect.die(refusal("not a runtime NEXUS made"));
  }

  const { lifecycle } = record;

  return Effect.suspend(() => lifecycle.state.claimed
    ? Deferred.await(lifecycle.begun).pipe(Effect.andThen(Effect.die(refusal("the runtime has begun terminating"))))
    : lifecycle.admission.withPermits(1)(Effect.suspend(() => lifecycle.state.accepting
      ? effect
      : Effect.die(refusal("the runtime has begun terminating")))));
};
