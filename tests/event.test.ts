import { describe, it, expect } from "vitest";
import { Effect, Fiber, Schema, Stream } from "effect";
import * as EventModule from "../src/event/index.js";

const UserSelected = EventModule.define("UserSelected", Schema.Struct({ userId: Schema.String }));
const OrderPlaced = EventModule.define("OrderPlaced", Schema.Struct({ orderId: Schema.String }));

describe("Event", () => {
  it("rejects a malformed payload when validated against its schema", async () => {
    const exit = await Effect.runPromiseExit(Schema.decodeUnknown(UserSelected.schema)({ userId: 42 }));
    expect(exit._tag).toBe("Failure");
  });

  it("delivers published events to a subscriber, in order", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(EventModule.subscribe(UserSelected), 2)));
          yield* Effect.sleep("1 millis");
          yield* EventModule.publish(UserSelected, { userId: "u1" });
          yield* EventModule.publish(UserSelected, { userId: "u2" });
          return yield* Fiber.join(fiber);
        })
      ).pipe(Effect.provide(EventModule.EventBusLive))
    );
    expect(Array.from(result)).toEqual([{ userId: "u1" }, { userId: "u2" }]);
  });

  it("only delivers events matching the subscribed tag", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(EventModule.subscribe(UserSelected), 1)));
          yield* Effect.sleep("1 millis");
          yield* EventModule.publish(OrderPlaced, { orderId: "o1" });
          yield* EventModule.publish(UserSelected, { userId: "u1" });
          return yield* Fiber.join(fiber);
        })
      ).pipe(Effect.provide(EventModule.EventBusLive))
    );
    expect(Array.from(result)).toEqual([{ userId: "u1" }]);
  });
});
