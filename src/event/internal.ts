// Event bus internals. Not re-exported by src/index.ts: nothing here is public.
import type { EventBusShape } from "./index.js";

import { Context, Effect, Exit, PubSub, Scope, Semaphore } from "effect";

import { refusal } from "../runtime/internal.js";

export interface Envelope {
  readonly _tag: string;
  readonly payload: unknown;
}

export const EventBus = Context.Service<EventBusShape>("nexus/EventBus");

export interface Bus {
  readonly shape: EventBusShape;
  /**
   * Closes the bus (idempotent). Every live subscription is shut down, so
   * each subscription ends normally and nothing still buffered is delivered. A
   * subscription taken afterwards ends at once. Publishing keeps succeeding,
   * reaching no subscriber.
   */
  readonly close: Effect.Effect<void>;
}

export const makeBus: Effect.Effect<Bus> = Effect.Do.pipe(
  Effect.bind("pubsub", () => PubSub.unbounded<Envelope>()),
  // Guards `closed` and `live` together, so a subscription is either registered
  // before the bus closes (and then shut down by it) or refused after.
  Effect.bind("lock", () => Semaphore.make(1)),
  // Each subscription is held in a scope of the bus's own, not only the subscriber's: closing that scope shuts the one subscription down, and its stream
  // ends normally. `PubSub.shutdown` would interrupt every subscriber instead, and would also refuse later publishes.
  Effect.let("state", () => ({ closed: false, live: new Set<Scope.Closeable>() })),
  // Per bus (so per runtime): tag -> the def that first used it. It holds the def
  // strongly for the bus lifetime and is dropped with the runtime.
  Effect.let("claimed", () => new Map<string, object>()),
  Effect.map(({ pubsub, lock, state, claimed }): Bus => ({
    shape: {
      claim: (event) => Effect.suspend(() => {
        const first = claimed.get(event._tag) ?? (claimed.set(event._tag, event), event);

        return first === event ? Effect.void : Effect.die(refusal("duplicate-event-tag"));
      }),
      publish: (envelope: Envelope) => PubSub.publish(pubsub, envelope).pipe(Effect.asVoid),
      // Uninterruptible from making the scope to registering its finalizer: interrupted in between, the scope would belong to no one and never close, and its
      // subscription would buffer every publish for the runtime's lifetime. No step in it waits, so taking the lock is the only interruptible part.
      subscribe: lock.withPermits(1)(Effect.uninterruptible(Effect.Do.pipe(
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("subscription", ({ scope }) => Scope.provide(PubSub.subscribe(pubsub), scope)),
        // After the bus closed, the subscription is shut down before it is handed over, so it ends at once.
        Effect.tap(({ scope }) => state.closed ? Scope.close(scope, Exit.void) : Effect.sync(() => { state.live.add(scope); })),
        Effect.tap(({ scope }) => Effect.addFinalizer(() => Effect.sync(() => { state.live.delete(scope); }).pipe(Effect.andThen(Scope.close(scope, Exit.void))))),
        Effect.map(({ subscription }) => subscription)
      ))),
    },
    close: lock.withPermits(1)(Effect.suspend(() => {
      if (state.closed) {
        return Effect.void;
      }

      state.closed = true;

      return Effect.forEach(Array.from(state.live), (scope) => Scope.close(scope, Exit.void), { discard: true });
    })),
  }))
);
