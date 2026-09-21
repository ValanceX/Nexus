import { Effect, Exit, Fiber, Schema, Stream } from "effect";
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
});
