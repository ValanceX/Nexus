// Runtime internals. Not re-exported by src/index.ts: nothing here is public.
import type { Bus } from "../event/internal.js";

import { Deferred, Effect, Exit, Fiber, Runtime as EffectRuntime, Scope } from "effect";

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

/** The stable identity of a refusal: why NEXUS refused. */
export type RefusalCode =
  /** Termination has been requested, so no new work is admitted. */
  | "terminating"
  /** The handle is not a runtime NEXUS made. */
  | "not-a-runtime"
  /** The handle is not an application NEXUS started. */
  | "not-an-application";

const REFUSAL: unique symbol = Symbol.for("@valancex/nexus/Refusal") as never;

const REFUSALS: Record<RefusalCode, string> = {
  terminating: "the runtime has begun terminating",
  "not-a-runtime": "not a runtime NEXUS made",
  "not-an-application": "not an application NEXUS started",
};

/**
 * The defect lifecycle and handle misuse die with. It is a defect, never a
 * typed failure (the `E` channel is for what a caller handles; using a handle
 * after termination began is misuse, and a command racing a shutdown is not
 * something its caller can fix). It carries a stable `code` (as the other packages' thrown errors do; `_tag` stays for typed failures in the `E` channel), so a caller can
 * tell the causes apart without reading the message.
 */
export class Refusal extends Error {
  readonly code: RefusalCode;
  /** Marks the value as a refusal across copies of the package. */
  readonly [REFUSAL]: true = true;

  constructor(code: RefusalCode) {
    super(`NEXUS: ${REFUSALS[code]}`);
    this.code = code;
  }
}

/**
 * Whether `value`, usually a defect taken from a `Cause`, is a refusal. It
 * reads the value's shape, not its class, so it still works when two copies of
 * the package are installed.
 */
export const isRefusal = (value: unknown): value is Refusal => {
  if (!(value instanceof Error) || (value as unknown as Record<symbol, unknown>)[REFUSAL] !== true) {
    return false;
  }

  const code: unknown = (value as Error & { code?: unknown }).code;

  return typeof code === "string" && Object.hasOwn(REFUSALS, code);
};

export const refusal = (code: RefusalCode): Refusal => new Refusal(code);

/**
 * Runs `effect` in a child fiber of the calling fiber, and returns its result,
 * without ever taking the child's FiberRefs (v0.9 C29, C30). The child inherits
 * the caller's FiberRefs when it's forked, so the caller's values still enter.
 * Nothing the child writes comes back: it's observed with `Fiber.await`, never
 * `Fiber.join`, which would copy its FiberRefs into the caller (P1).
 *
 * Interrupting the caller interrupts the child and waits for it to finish, so
 * whatever the child acquired is released before the caller carries on (C31).
 */
export const isolated = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> => Effect.uninterruptibleMask((restore) =>
  Effect.flatMap(Effect.fork(restore(effect)), (fiber) => restore(Fiber.await(fiber)).pipe(
    Effect.onInterrupt(() => Fiber.interrupt(fiber)),
    Effect.flatten
  ))
);

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
 * 5. runs `onEnd` (an application's `Stopped`), even when a release failed.
 * Every other caller waits until all of that is done, then completes normally.
 * If a release failed, the claimer alone then re-raises that failure's cause.
 * Uninterruptible, so a termination that has been claimed always completes.
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
    // A failed release must not strand the lifecycle: finish it, then re-raise.
    // Released in its own fiber, so no release writes a FiberRef into the
    // fiber that terminates (I46).
    Effect.andThen(Effect.exit(isolated(Scope.close(lifecycle.scope, Exit.void)))),
    Effect.tap(() => lifecycle.hooks.onEnd),
    Effect.tap(() => Deferred.succeed(lifecycle.terminated, undefined)),
    Effect.flatMap((released) => released)
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
    return Effect.die(refusal("not-a-runtime"));
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
      return Effect.die(refusal("terminating"));
    }

    lifecycle.state.admitted += 1;

    return restore(effect).pipe(Effect.ensuring(finish));
  }));
};
