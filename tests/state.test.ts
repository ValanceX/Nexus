import { Effect, Exit, Fiber, Schema, Stream } from "effect";
import { describe, it, expect } from "vitest";

import * as State from "../src/state/index.js";

const Counter = Schema.Struct({ count: Schema.Number });

describe("State", () => {
  it("initializes from a schema-valid value", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(State.create(Counter, { count: 0 })),
      Effect.andThen((counter) => State.get(counter))
    )));

    expect(result).toEqual({ count: 0 });
  });

  it("rejects an invalid initial value", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(State.create(Counter, { count: "not-a-number" } as unknown as { count: number }))
    );

    expect(exit).is.satisfies(Exit.isFailure);
  });

  it("applies explicit transitions without mutating the previous value", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("counter", () => State.create(Counter, { count: 0 })),
      Effect.bind("before", ({ counter }) => State.get(counter)),
      Effect.tap(({ counter }) => State.update(counter, (s) => Effect.succeed({ count: s.count + 1 }))),
      Effect.bind("after", ({ counter }) => State.get(counter)),
      Effect.map(({ before, after }) => ({ before, after }))
    )));

    expect(result.before).toEqual({ count: 0 });
    expect(result.after).toEqual({ count: 1 });
  });

  it("emits exactly one change per commit, in order", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("counter", () => State.create(Counter, { count: 0 })),
      Effect.bind("fiber", ({ counter }) => Effect.fork(Stream.runCollect(Stream.take(counter.changes, 2)))),
      Effect.tap(() => Effect.sleep("1 millis")),
      Effect.tap(({ counter }) => State.update(counter, (s) => Effect.succeed({ count: s.count + 1 }))),
      Effect.tap(({ counter }) => State.update(counter, (s) => Effect.succeed({ count: s.count + 1 }))),
      Effect.andThen(({ fiber }) => Fiber.join(fiber))
    )));

    expect(Array.from(result)).toEqual([{ count: 1 }, { count: 2 }]);
  });

  it("applies concurrent updates atomically — no lost writes", async () => {
    // Each transition yields (Effect.sleep) between reading `current` and
    // returning the next value. A non-atomic read-modify-write interleaves
    // there and loses writes; an atomic one serializes and lands on 50.
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("counter", () => State.create(Counter, { count: 0 })),
      Effect.tap(({ counter }) => Effect.all(
        Array.from({ length: 50 }, () =>
          State.update(counter, (s) => Effect.sleep("1 millis").pipe(Effect.as({ count: s.count + 1 })))
        ),
        { concurrency: "unbounded" }
      )),
      Effect.andThen(({ counter }) => State.get(counter))
    )));

    expect(result).toEqual({ count: 50 });
  });

  it("rejects a schema-invalid value passed to set", async () => {
    const exit = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(State.create(Counter, { count: 0 })),
      Effect.andThen((counter) => Effect.exit(State.set(counter, { count: "nope" } as unknown as { count: number })))
    )));

    expect(exit).is.satisfies(Exit.isFailure);
  });
});
