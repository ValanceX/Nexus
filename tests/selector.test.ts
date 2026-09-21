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
});
