import { describe, it, expect } from "vitest";
import { Effect, Fiber, Schema, Stream } from "effect";
import * as Selector from "../src/selector/index.js";
import * as State from "../src/state/index.js";

const Cart = Schema.Struct({ items: Schema.Array(Schema.String) });

describe("Selector", () => {
  it("deterministically derives from the current state value", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const cart = yield* State.create(Cart, { items: [] });
          const canCheckout = Selector.define(cart, (s) => s.items.length > 0);
          return yield* canCheckout.value;
        })
      )
    );
    expect(result).toBe(false);
  });

  it("reacts to state changes", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const cart = yield* State.create(Cart, { items: [] });
          const canCheckout = Selector.define(cart, (s) => s.items.length > 0);
          const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(canCheckout.changes, 1)));
          yield* Effect.sleep("1 millis");
          yield* State.update(cart, (s) => Effect.succeed({ items: [...s.items, "sku-1"] }));
          return yield* Fiber.join(fiber);
        })
      )
    );
    expect(Array.from(result)).toEqual([true]);
  });

  it("combines two selectors without either reaching into state directly", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const cart = yield* State.create(Cart, { items: ["sku-1"] });
          const count = Selector.define(cart, (s) => s.items.length);
          const label = Selector.define(cart, (s) => (s.items.length > 0 ? "full" : "empty"));
          const combined = Selector.combine(count, label, (c, l) => `${c}:${l}`);
          return yield* combined.value;
        })
      )
    );
    expect(result).toBe("1:full");
  });
});
