import type { Envelope } from "./internal.js";

import type { ParseResult } from "effect";
import { Effect, Layer, Queue, Schema, Scope, Stream } from "effect";
import { EventBus, makeBus } from "./internal.js";

// `Encoded` defaults to `Payload`, so `EventDef<Tag, P>` still means a
// non-transforming schema. The bus carries decoded `Payload` values.
export interface EventDef<Tag extends string, Payload, Encoded = Payload> {
  readonly _tag: Tag;
  readonly schema: Schema.Schema<Payload, Encoded>;
}

export const define = <Tag extends string, Payload, Encoded = Payload>(tag: Tag, schema: Schema.Schema<Payload, Encoded>): EventDef<Tag, Payload, Encoded> => ({
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

export const publish = <Tag extends string, Payload, Encoded = Payload>(event: EventDef<Tag, Payload, Encoded>, payload: Payload): Effect.Effect<void, never, EventBusShape> => Effect.flatMap(EventBus, (bus) =>
  bus.publish({ _tag: event._tag, payload })
);

// `validate: true` checks each payload against the schema's decoded (type) side:
// the bus carries decoded values, so a transforming schema is not decoded a
// second time. A payload that fails ends the stream with the ParseError.
export function subscribe<Tag extends string, Payload, Encoded = Payload>(event: EventDef<Tag, Payload, Encoded>, options: { readonly validate: true }): Stream.Stream<Payload, ParseResult.ParseError, EventBusShape>;
export function subscribe<Tag extends string, Payload, Encoded = Payload>(event: EventDef<Tag, Payload, Encoded>, options?: { readonly validate?: false }): Stream.Stream<Payload, never, EventBusShape>;
export function subscribe<Tag extends string, Payload, Encoded = Payload>(event: EventDef<Tag, Payload, Encoded>, options: { readonly validate: boolean }): Stream.Stream<Payload, ParseResult.ParseError, EventBusShape>;
export function subscribe<Tag extends string, Payload, Encoded = Payload>(event: EventDef<Tag, Payload, Encoded>, options?: { readonly validate?: boolean }): Stream.Stream<Payload, ParseResult.ParseError, EventBusShape> {
  const check = Schema.decodeUnknown(Schema.typeSchema(event.schema));

  return Stream.unwrapScoped(Effect.Do.pipe(
    Effect.andThen(EventBus),
    Effect.andThen((bus) => bus.subscribe),
    // One event per pull (D4): an event is taken from the queue only when the
    // subscriber asks for the next one, so events still buffered when the bus
    // closes stay in the queue and are discarded with it, never handed over later.
    Effect.map((dequeue) => Stream.fromQueue(dequeue, { maxChunkSize: 1 }).pipe(
      Stream.filter((envelope) => envelope._tag === event._tag),
      options?.validate === true
        ? Stream.mapEffect((envelope) => check(envelope.payload))
        : Stream.map((envelope) => envelope.payload as Payload)
    ))
  ));
}
