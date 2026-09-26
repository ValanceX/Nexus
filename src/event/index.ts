import type { Envelope } from "./internal.js";

import { Effect, Layer, Queue, Schema, Scope, Stream } from "effect";

import { EventBus, makeBus } from "./internal.js";

export interface EventDef<Tag extends string, Payload> {
  readonly _tag: Tag;
  readonly schema: Schema.Schema<Payload>;
}

export const define = <Tag extends string, Payload>(tag: Tag, schema: Schema.Schema<Payload>): EventDef<Tag, Payload> => ({
  _tag: tag, schema
});

// The bus service shape. Event.publish/Event.subscribe (below) remain the
// public, per-EventDef API surface documented in docs/primitives/event.md —
// this type is exported so that it can be named in a Layer's requirements
// (`Layer.Layer<R, E, EventBusShape>`) and in NexusRuntime<R | EventBusShape>.
export interface EventBusShape {
  readonly publish: (envelope: Envelope) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<Queue.Dequeue<Envelope>, never, Scope.Scope>;
}

// A bus that closes with its layer's scope: every subscription then ends
// normally, and nothing is delivered after (event.md, Lifecycle).
export const EventBusLive: Layer.Layer<EventBusShape, never, never> = Layer.scoped(
  EventBus,
  makeBus.pipe(
    Effect.tap(({ close }) => Effect.addFinalizer(() => close)),
    Effect.map(({ shape }) => shape)
  )
);

export const publish = <Tag extends string, Payload>(event: EventDef<Tag, Payload>, payload: Payload): Effect.Effect<void, never, EventBusShape> => Effect.flatMap(EventBus, (bus) =>
  bus.publish({ _tag: event._tag, payload })
);

export const subscribe = <Tag extends string, Payload>(event: EventDef<Tag, Payload>): Stream.Stream<Payload, never, EventBusShape> => Stream.unwrapScoped(Effect.Do.pipe(
  Effect.andThen(EventBus),
  Effect.andThen((bus) => bus.subscribe),
  Effect.map((dequeue) => Stream.fromQueue(dequeue).pipe(
    Stream.filter((envelope): envelope is Envelope & { readonly payload: Payload } => envelope._tag === event._tag),
    Stream.map((envelope) => envelope.payload as Payload)
  ))
));
