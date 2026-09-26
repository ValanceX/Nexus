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
  readonly terminated: Deferred.Deferred<void>;
  readonly state: { accepting: boolean; claimed: boolean };
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
  Effect.bind("terminated", () => Deferred.make<void>()),
  Effect.map(({ scope, admission, terminated }): Lifecycle => ({ scope, bus, admission, terminated, state: { accepting: true, claimed: false } }))
);

/**
 * Terminates a runtime, once: stop admitting new work, close the bus (no event
 * is delivered after this, D4), then close the scope, releasing every resource.
 * A second call waits for the first to finish. Uninterruptible, so a termination
 * that has begun always completes.
 */
export const terminateLifecycle = (lifecycle: Lifecycle): Effect.Effect<void> => Effect.uninterruptible(Effect.suspend(() => {
  if (lifecycle.state.claimed) {
    return Deferred.await(lifecycle.terminated);
  }

  lifecycle.state.claimed = true;

  return Effect.Do.pipe(
    Effect.andThen(lifecycle.admission.withPermits(1)(Effect.sync(() => { lifecycle.state.accepting = false; }))),
    Effect.andThen(lifecycle.bus.close),
    Effect.andThen(Scope.close(lifecycle.scope, Exit.void)),
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
 * `effect` either completes before termination begins, or doesn't run.
 */
export const admit = <A, E>(handle: NexusRuntime<never>, effect: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const record = recordOf(handle);

  return record === undefined
    ? Effect.die(refusal("not a runtime NEXUS made"))
    : record.lifecycle.admission.withPermits(1)(Effect.suspend(() => record.lifecycle.state.accepting
      ? effect
      : Effect.die(refusal("the runtime has begun terminating"))));
};
