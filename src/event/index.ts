import { Context, Effect, Layer, PubSub, Queue, Schema, Scope, Stream } from "effect";

export interface EventDef<Tag extends string, Payload> {
  readonly _tag: Tag;
  readonly schema: Schema.Schema<Payload>;
}

export const define = <Tag extends string, Payload>(
  tag: Tag,
  schema: Schema.Schema<Payload>
): EventDef<Tag, Payload> => ({ _tag: tag, schema });

interface Envelope {
  readonly _tag: string;
  readonly payload: unknown;
}

interface EventBusShape {
  readonly publish: (envelope: Envelope) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<Queue.Dequeue<Envelope>, never, Scope.Scope>;
}

// Internal representation only — Event.publish/Event.subscribe (below) are the
// public, per-EventDef API surface documented in docs/primitives/event.md.
const EventBus = Context.GenericTag<EventBusShape>("nexus/EventBus");

export const EventBusLive: Layer.Layer<EventBusShape, never, never> = Layer.scoped(
  EventBus,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<Envelope>();
    return {
      publish: (envelope: Envelope) => PubSub.publish(pubsub, envelope).pipe(Effect.map(() => undefined)),
      subscribe: PubSub.subscribe(pubsub),
    };
  })
);

export const publish = <Tag extends string, Payload>(
  event: EventDef<Tag, Payload>,
  payload: Payload
): Effect.Effect<void, never, EventBusShape> =>
  Effect.flatMap(EventBus, (bus) => bus.publish({ _tag: event._tag, payload }));

export const subscribe = <Tag extends string, Payload>(
  event: EventDef<Tag, Payload>
): Stream.Stream<Payload, never, EventBusShape> =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      const dequeue = yield* bus.subscribe;
      return Stream.fromQueue(dequeue).pipe(
        Stream.filter((envelope): envelope is Envelope & { readonly payload: Payload } => envelope._tag === event._tag),
        Stream.map((envelope) => envelope.payload as Payload)
      );
    })
  );
