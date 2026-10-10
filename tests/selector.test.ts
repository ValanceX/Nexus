import { Effect, Fiber, Schema, Stream } from "effect";
import { describe, it, expect } from "vitest";

import * as Selector from "../src/selector/index.js";
import * as State from "../src/state/index.js";

const Cart = Schema.Struct({ items: Schema.Array(Schema.String) });

describe("Selector", () => {
  it("deterministically derives from the current state value", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(() => State.create(Cart, { items: [] })),
      Effect.andThen((cart) => Selector.define(cart, (s) => s.items.length > 0).value),
    )));

    expect(result).toBe(false);
  });

  it("reacts to state changes", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind('cart', () => State.create(Cart, { items: [] })),
      Effect.let('canCheckout', ({ cart }) => Selector.define(cart, (s) => s.items.length > 0)),
      Effect.bind('fiber', ({ canCheckout }) => Effect.fork(Stream.runCollect(Stream.take(canCheckout.changes, 1)))),
      Effect.andThen(({ cart, fiber }) => Effect.Do.pipe(
        Effect.andThen(Effect.sleep("1 millis")),
        Effect.andThen(State.update(cart, (s) => Effect.succeed({ items: [...s.items, "sku-1"] }))),
        Effect.andThen(Fiber.join(fiber))
      ))
    )));

    expect(Array.from(result)).toEqual([true]);
  });

  it("combines two selectors without either reaching into state directly", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(() => State.create(Cart, { items: ["sku-1"] })),
      Effect.andThen((cart) => {
        const count = Selector.define(cart, (s) => s.items.length);
        const label = Selector.define(cart, (s) => (s.items.length > 0 ? "full" : "empty"));

        return Selector.combine(count, label, (c, l) => `${c}:${l}`).value;
      })
    )));

    expect(result).toBe("1:full");
  });

  it("combine.changes emits for the first commit of either input, with the other's current value, and not for the present", async () => {
    const Two = Schema.Struct({ n: Schema.Number });
    const emitted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const left = yield* State.create(Two, { n: 1 });
      const right = yield* State.create(Two, { n: 10 });
      const sum = Selector.combine(Selector.define(left, (s) => s.n), Selector.define(right, (s) => s.n), (a, b) => a + b);
      const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(sum.changes, 2)));

      yield* Effect.sleep(20);
      yield* State.set(left, { n: 2 });   // the first commit on one side: 2 + 10
      yield* Effect.sleep(20);
      yield* State.set(right, { n: 20 }); // then the other: 2 + 20

      return Array.from(yield* Fiber.join(fiber));
    })));

    expect(emitted).toEqual([12, 22]);
  });
});
