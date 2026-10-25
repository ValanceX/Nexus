// Event bus internals. Not re-exported by src/index.ts: nothing here is public.
import type { EventBusShape } from "./index.js";

import { Context, Effect, PubSub, Queue, Scope } from "effect";

import { refusal } from "../runtime/internal.js";

export interface Envelope {
  readonly _tag: string;
  readonly payload: unknown;
}

export const EventBus = Context.GenericTag<EventBusShape>("nexus/EventBus");

export interface Bus {
  readonly shape: EventBusShape;
  /**
   * Closes the bus (idempotent). Every live subscription queue is shut down, so
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
  Effect.bind("lock", () => Effect.makeSemaphore(1)),
  Effect.let("state", () => ({ closed: false, live: new Set<Queue.Dequeue<Envelope>>() })),
  // Per bus (so per runtime): the def that first used each tag.
  Effect.let("claimed", () => new Map<string, object>()),
  Effect.map(({ pubsub, lock, state, claimed }): Bus => ({
    shape: {
      claim: (event) => Effect.suspend(() => {
        const first = claimed.get(event._tag) ?? (claimed.set(event._tag, event), event);

        return first === event ? Effect.void : Effect.die(refusal("duplicate-event-tag"));
      }),
      publish: (envelope: Envelope) => PubSub.publish(pubsub, envelope).pipe(Effect.asVoid),
      subscribe: lock.withPermits(1)(Effect.suspend((): Effect.Effect<Queue.Dequeue<Envelope>, never, Scope.Scope> => state.closed
        ? Queue.unbounded<Envelope>().pipe(Effect.tap(Queue.shutdown))
        : PubSub.subscribe(pubsub).pipe(
            Effect.tap((queue) => Effect.sync(() => { state.live.add(queue); })),
            Effect.tap((queue) => Effect.addFinalizer(() => Effect.sync(() => { state.live.delete(queue); })))
          ))),
    },
    close: lock.withPermits(1)(Effect.suspend(() => {
      if (state.closed) {
        return Effect.void;
      }

      state.closed = true;

      return Effect.forEach(Array.from(state.live), Queue.shutdown, { discard: true });
    })),
  }))
);
