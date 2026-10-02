// v0.10: `values`, the current value and then every change, with no gap between them.
//
// The gap it closes: `get` and then `changes` are two operations, and a commit between them is seen by neither
// (`changes` is future commits only). The Valance tracer bullet lost an update this way: state 1, DOM 0.
import { Chunk, Effect, Exit, Fiber, Option, Schema, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";

import * as Selector from "../src/selector/index.js";
import * as State from "../src/state/index.js";

const Counter = Schema.Struct({ count: Schema.Number });

/** Yields `n` times: moves a commit to a different point of the other fiber's progress. */
const yields = (n: number): Effect.Effect<void> => n <= 0 ? Effect.void : Effect.yieldNow().pipe(Effect.andThen(yields(n - 1)));

/** Collects `stream` until it has seen `last`. Bounded: a lost final value times out instead of hanging. */
const collectUntil = <E>(stream: Stream.Stream<number, E>, last: number): Effect.Effect<ReadonlyArray<number>, E | "timeout"> =>
  Stream.runCollect(Stream.takeUntil(stream, (value) => value === last)).pipe(
    Effect.timeoutFail({ duration: "2 seconds", onTimeout: () => "timeout" as const }),
    Effect.map(Chunk.toReadonlyArray)
  );

/** The shape every atomic observation must have: a contiguous run of commits, ending at the last one. */
const contiguousTo = (seen: ReadonlyArray<number>, last: number): boolean =>
  seen.length > 0 && seen.at(-1) === last && seen.every((value, index) => index === 0 || value === seen[index - 1]! + 1);

describe("the gap `values` closes", () => {
  it("get-then-changes misses a commit made between them (the two-step observation)", async () => {
    const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const counter = yield* State.create(Counter, { count: 0 });
      const current = yield* counter.get;
      yield* counter.set({ count: 1 });                                           // lands in the gap
      const afterGap = yield* Stream.runCollect(Stream.take(counter.changes, 1)).pipe(Effect.timeoutOption("20 millis"));

      return { current, afterGap };
    })));

    // The observer holds 0, state is 1, and `changes` never delivers the 1.
    expect(outcome.current).toEqual({ count: 0 });
    expect(Option.isNone(outcome.afterGap)).toBe(true);
  });
});

describe("State.values", () => {
  it("emits the current value first, then every commit, in order", async () => {
    const seen = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const counter = yield* State.create(Counter, { count: 0 });
      const collector = yield* Effect.fork(collectUntil(Stream.map(counter.values, (value) => value.count), 2));
      yield* Effect.sleep("1 millis");
      yield* counter.set({ count: 1 });
      yield* counter.set({ count: 2 });

      return yield* Fiber.join(collector);
    })));

    expect(seen).toEqual([0, 1, 2]);
  });

  it("emits the current value at subscription, not the initial one", async () => {
    const seen = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const counter = yield* State.create(Counter, { count: 0 });
      yield* counter.set({ count: 5 });

      return yield* Stream.runCollect(Stream.take(counter.values, 1));
    })));

    expect(Chunk.toReadonlyArray(seen)).toEqual([{ count: 5 }]);
  });

  it("has no gap: commits racing the subscription, at every relative timing, are a contiguous run ending at the last", async () => {
    // Writer and subscriber start together; `delay` moves the subscription across the writer's three commits.
    const runs = await Effect.runPromise(Effect.forEach(
      Array.from({ length: 16 }, (_, delay) => delay),
      (delay) => Effect.scoped(Effect.gen(function* () {
        const counter = yield* State.create(Counter, { count: 0 });
        const writer = yield* Effect.fork(Effect.forEach([1, 2, 3], (count) => yields(2).pipe(Effect.andThen(counter.set({ count }))), { discard: true }));
        const collector = yield* Effect.fork(yields(delay).pipe(Effect.andThen(collectUntil(Stream.map(counter.values, (value) => value.count), 3))));
        yield* Fiber.join(writer);

        return yield* Fiber.join(collector);
      })),
      { concurrency: 1 }
    ));

    for (const seen of runs) {
      expect(contiguousTo(seen, 3)).toBe(true);
    }
    // The subscription really did land at different points: not every run began at the same value.
    expect(new Set(runs.map((seen) => seen[0])).size).toBeGreaterThan(1);
  });

  it("keeps every commit that lands while a slow consumer is still working", async () => {
    const seen = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const counter = yield* State.create(Counter, { count: 0 });
      const collector = yield* Effect.fork(collectUntil(Stream.mapEffect(Stream.map(counter.values, (value) => value.count), (n) => Effect.sleep("3 millis").pipe(Effect.as(n))), 3));
      yield* Effect.sleep("1 millis");
      yield* Effect.forEach([1, 2, 3], (count) => counter.set({ count }), { discard: true });   // all land during the first slow step

      return yield* Fiber.join(collector);
    })));

    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("completes normally when the owning scope closes, like changes", async () => {
    const collected = await Effect.runPromise(Effect.gen(function* () {
      const owner = yield* Scope.make();
      const counter = yield* Scope.extend(State.create(Counter, { count: 0 }), owner);
      const fiber = yield* Effect.fork(Stream.runCollect(counter.values));
      yield* Effect.sleep("2 millis");
      yield* Scope.close(owner, Exit.void);

      return Chunk.toReadonlyArray(yield* Fiber.join(fiber));
    }));

    expect(collected).toEqual([{ count: 0 }]);
  });
});

describe("Selector.values", () => {
  it("projects the current value first, then each commit", async () => {
    const seen = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const counter = yield* State.create(Counter, { count: 1 });
      const doubled = Selector.define(counter, (state) => state.count * 2);
      const collector = yield* Effect.fork(collectUntil(doubled.values, 6));
      yield* Effect.sleep("1 millis");
      yield* counter.set({ count: 3 });

      return yield* Fiber.join(collector);
    })));

    expect(seen).toEqual([2, 6]);
  });

  it("combine: starts from both selectors' current values, then follows either", async () => {
    const seen = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const a = yield* State.create(Counter, { count: 1 });
      const b = yield* State.create(Counter, { count: 10 });
      const sum = Selector.combine(Selector.define(a, (s) => s.count), Selector.define(b, (s) => s.count), (x, y) => x + y);
      const collector = yield* Effect.fork(collectUntil(sum.values, 13));
      yield* Effect.sleep("1 millis");
      yield* a.set({ count: 2 });
      yield* b.set({ count: 11 });

      return yield* Fiber.join(collector);
    })));

    expect(seen[0]).toBe(11);
    expect(seen.at(-1)).toBe(13);
  });
});
