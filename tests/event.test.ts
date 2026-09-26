import { Chunk, Context, Duration, Effect, Exit, Fiber, Layer, Queue, Ref, Schedule, Schema, Scope, Stream } from "effect";
import { describe, it, expect } from "vitest";

import * as EventModule from "../src/event/index.js";

const UserSelected = EventModule.define("UserSelected", Schema.Struct({ userId: Schema.String }));
const OrderPlaced = EventModule.define("OrderPlaced", Schema.Struct({ orderId: Schema.String }));

describe("Event", () => {
  it("rejects a malformed payload when validated against its schema", async () => {
    const exit = await Effect.runPromiseExit(Schema.decodeUnknown(UserSelected.schema)({ userId: 42 }));
    expect(exit).is.satisfies(Exit.isFailure);
  });

  it("delivers published events to a subscriber, in order", async () => {
    const result = await Effect.runPromise(Effect.Do.pipe(
      Effect.andThen(Effect.scoped(Effect.Do.pipe(
        Effect.andThen(Effect.fork(Stream.runCollect(Stream.take(EventModule.subscribe(UserSelected), 2)))),
        Effect.andThen((fiber) => Effect.Do.pipe(
          Effect.andThen(Effect.sleep("1 millis")),
          Effect.andThen(EventModule.publish(UserSelected, { userId: "u1" })),
          Effect.andThen(EventModule.publish(UserSelected, { userId: "u2" })),
          Effect.andThen(Fiber.join(fiber))
        )),
      ))),
      Effect.provide(EventModule.EventBusLive)
    ));

    expect(Array.from(result)).toEqual([{ userId: "u1" }, { userId: "u2" }]);
  });

  it("only delivers events matching the subscribed tag", async () => {
    const result = await Effect.runPromise(Effect.Do.pipe(
      Effect.andThen(Effect.scoped(Effect.Do.pipe(
        Effect.andThen(Effect.fork(Stream.runCollect(Stream.take(EventModule.subscribe(UserSelected), 1)))),
        Effect.andThen((fiber) => Effect.Do.pipe(
          Effect.andThen(Effect.sleep("1 millis")),
          Effect.andThen(EventModule.publish(OrderPlaced, { orderId: "o1" })),
          Effect.andThen(EventModule.publish(UserSelected, { userId: "u1" })),
          Effect.andThen(Fiber.join(fiber)),
        ))
      ))),
      Effect.provide(EventModule.EventBusLive)
    ));

    expect(Array.from(result)).toEqual([{ userId: "u1" }]);
  });

  describe("closing (N1, D4)", () => {
    // Waits, boundedly, until `get` satisfies `done`.
    const eventually = <A>(get: Effect.Effect<A>, done: (a: A) => boolean): Effect.Effect<A, unknown> =>
      get.pipe(Effect.filterOrFail(done), Effect.retry(Schedule.spaced("1 millis")), Effect.timeout(Duration.seconds(1)));

    it("ends every subscription normally when the bus's scope closes, delivering nothing after", async () => {
      const result = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("busScope", () => Scope.make()),
        Effect.bind("bus", ({ busScope }) => Layer.buildWithScope(EventModule.EventBusLive, busScope)),
        Effect.bind("seen", () => Ref.make<ReadonlyArray<{ readonly userId: string }>>([])),
        Effect.bind("consumer", ({ bus, seen }) => Effect.forkDaemon(Stream.runForEach(EventModule.subscribe(UserSelected), (event) => Ref.update(seen, (xs) => [...xs, event])).pipe(Effect.provide(bus)))),
        Effect.tap(() => Effect.sleep("1 millis")),
        Effect.tap(({ bus }) => EventModule.publish(UserSelected, { userId: "before" }).pipe(Effect.provide(bus))),
        Effect.tap(({ seen }) => eventually(Ref.get(seen), (xs) => xs.length === 1)),
        Effect.tap(({ busScope }) => Scope.close(busScope, Exit.void)),
        Effect.bind("exit", ({ consumer }) => Fiber.await(consumer).pipe(Effect.timeout(Duration.seconds(1)))),
        Effect.bind("publishAfter", ({ bus }) => Effect.exit(EventModule.publish(UserSelected, { userId: "after" }).pipe(Effect.provide(bus)))),
        Effect.bind("late", ({ bus }) => Stream.runCollect(EventModule.subscribe(UserSelected)).pipe(Effect.provide(bus), Effect.timeout(Duration.seconds(1)))),
        Effect.bind("seenAtEnd", ({ seen }) => Ref.get(seen))
      ));

      expect(Exit.isSuccess(result.exit)).toBe(true);
      expect(result.seenAtEnd).toEqual([{ userId: "before" }]);
      expect(Exit.isSuccess(result.publishAfter)).toBe(true);
      expect(Chunk.toReadonlyArray(result.late)).toEqual([]);
    });

    it("shuts down a queue taken directly from the bus service", async () => {
      // The service tag isn't exported; a GenericTag with the same key resolves the same service.
      const Bus = Context.GenericTag<EventModule.EventBusShape>("nexus/EventBus");

      const shutDown = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("busScope", () => Scope.make()),
        Effect.bind("bus", ({ busScope }) => Layer.buildWithScope(EventModule.EventBusLive, busScope)),
        Effect.bind("subscriberScope", () => Scope.make()),
        Effect.bind("queue", ({ bus, subscriberScope }) => Scope.extend(Context.get(bus, Bus).subscribe, subscriberScope)),
        Effect.tap(({ busScope }) => Scope.close(busScope, Exit.void)),
        Effect.flatMap(({ queue }) => Queue.isShutdown(queue))
      ));

      expect(shutDown).toBe(true);
    });
  });
});
