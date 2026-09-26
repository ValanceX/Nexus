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
  /** Completed when the last admitted effect finishes after termination was claimed. */
  readonly drained: Deferred.Deferred<void>;
  readonly terminated: Deferred.Deferred<void>;
  /**
   * `claimed`: termination has been requested. From that moment no new work is
   * admitted, by `admit`, `run` or `runFork` alike. `admitted`: effects admitted
   * through `admit` that haven't finished. `accepting`: false once termination
   * has begun (an application's `Stopping`). Every read and write is synchronous,
   * so each check-and-update is atomic.
   */
  readonly state: { accepting: boolean; claimed: boolean; admitted: number };
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
  Effect.bind("drained", () => Deferred.make<void>()),
  Effect.bind("terminated", () => Deferred.make<void>()),
  Effect.map(({ scope, drained, terminated }): Lifecycle => ({
    scope, bus, drained, terminated,
    state: { accepting: true, claimed: false, admitted: 0 },
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
 * Terminates a runtime, once. The first caller claims the termination, which
 * ends admission at once: from here, `admit`, `run` and `runFork` refuse new
 * work. Then it:
 * 1. waits for work already admitted to finish;
 * 2. in one step: runs `onBegin` (an application's `Running → Stopping`) and
 *    marks the runtime as no longer accepting. This is the moment termination
 *    *begins*;
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
    Effect.andThen(Effect.suspend(() => lifecycle.state.admitted === 0 ? Effect.void : Deferred.await(lifecycle.drained))),
    Effect.andThen(lifecycle.hooks.onBegin),
    Effect.andThen(Effect.sync(() => { lifecycle.state.accepting = false; })),
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

/** Whether new work may start: the runtime exists, and termination hasn't been requested. */
export const admitting = (lifecycle: Lifecycle): boolean => lifecycle.state.accepting && !lifecycle.state.claimed;

/**
 * Runs `effect` as admitted work, or refuses it as a defect once termination has
 * been requested. Admitted work is counted, and termination waits for the count
 * to reach zero before it begins; so `effect` either completes before
 * termination begins, or never starts.
 *
 * Admission never waits: an admitted effect that requests more admitted work
 * (for example, a schema whose decode creates State) is either admitted at once
 * or, after termination has been claimed, refused at once. It can't deadlock
 * against termination, or against itself.
 */
export const admit = <A, E>(handle: NexusRuntime<never>, effect: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const record = recordOf(handle);

  if (record === undefined) {
    return Effect.die(refusal("not a runtime NEXUS made"));
  }

  const { lifecycle } = record;
  const finish = Effect.suspend(() => {
    lifecycle.state.admitted -= 1;

    return lifecycle.state.claimed && lifecycle.state.admitted === 0 ? Deferred.succeed(lifecycle.drained, undefined) : Effect.void;
  });

  // Counting and registering `finish` happen together, uninterruptibly, so an
  // admitted effect is always uncounted however it ends.
  return Effect.uninterruptibleMask((restore) => Effect.suspend(() => {
    if (!admitting(lifecycle)) {
      return Effect.die(refusal("the runtime has begun terminating"));
    }

    lifecycle.state.admitted += 1;

    return restore(effect).pipe(Effect.ensuring(finish));
  }));
};
