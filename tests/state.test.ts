import { describe, it, expect } from "vitest";
import { Effect, Fiber, Schema, Stream } from "effect";
import * as State from "../src/state/index.js";

const Counter = Schema.Struct({ count: Schema.Number });

describe("State", () => {
  it("initializes from a schema-valid value", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const counter = yield* State.create(Counter, { count: 0 });
          return yield* State.get(counter);
        })
      )
    );
    expect(result).toEqual({ count: 0 });
  });

  it("rejects an invalid initial value", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(State.create(Counter, { count: "not-a-number" } as unknown as { count: number }))
    );
    expect(exit._tag).toBe("Failure");
  });

  it("applies explicit transitions without mutating the previous value", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const counter = yield* State.create(Counter, { count: 0 });
          const before = yield* State.get(counter);
          yield* State.update(counter, (s) => Effect.succeed({ count: s.count + 1 }));
          const after = yield* State.get(counter);
          return { before, after };
        })
      )
    );
    expect(result.before).toEqual({ count: 0 });
    expect(result.after).toEqual({ count: 1 });
  });

  it("emits exactly one change per commit, in order", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const counter = yield* State.create(Counter, { count: 0 });
          const fiber = yield* Effect.fork(Stream.runCollect(Stream.take(counter.changes, 2)));
          yield* Effect.sleep("1 millis");
          yield* State.update(counter, (s) => Effect.succeed({ count: s.count + 1 }));
          yield* State.update(counter, (s) => Effect.succeed({ count: s.count + 1 }));
          return yield* Fiber.join(fiber);
        })
      )
    );
    expect(Array.from(result)).toEqual([{ count: 1 }, { count: 2 }]);
  });

  it("rejects a schema-invalid value passed to set", async () => {
    const exit = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const counter = yield* State.create(Counter, { count: 0 });
          return yield* Effect.exit(State.set(counter, { count: "nope" } as unknown as { count: number }));
        })
      )
    );
    expect(exit._tag).toBe("Failure");
  });
});
