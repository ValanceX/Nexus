import { Duration, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from "effect";
import { describe, it, expect } from "vitest";

import * as Application from "../src/application/index.js";
import * as Runtime from "../src/runtime/index.js";
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

  it("keeps changes open while its scope is alive, and completes it when the scope closes", async () => {
    const result = await Effect.runPromise(Effect.Do.pipe(
      Effect.bind("scope", () => Scope.make()),
      Effect.bind("counter", ({ scope }) => Scope.extend(State.create(Counter, { count: 0 }), scope)),
      // A daemon, so only the state's scope, not this fiber's parent, can end it.
      Effect.bind("fiber", ({ counter }) => Effect.forkDaemon(Stream.runCollect(counter.changes))),
      Effect.tap(() => Effect.sleep("1 millis")),
      Effect.tap(({ counter }) => State.set(counter, { count: 1 })),
      Effect.tap(() => Effect.sleep("20 millis")),
      Effect.bind("whileOpen", ({ fiber }) => Fiber.poll(fiber)),
      Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
      Effect.bind("exit", ({ fiber }) => Fiber.await(fiber).pipe(Effect.timeout(Duration.seconds(1)))),
      Effect.map(({ whileOpen, exit }) => ({ whileOpen, exit }))
    ));

    expect(Option.isNone(result.whileOpen)).toBe(true);
    expect(result.exit).is.satisfies(Exit.isSuccess);
    expect(Exit.isSuccess(result.exit) && Array.from(result.exit.value)).toEqual([{ count: 1 }]);
  });

  it("completes changes on Application.shutdown when the application's scope owns the state", async () => {
    const exit = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("running", () => Application.start(Application.define({ name: "state-lifecycle", runtime: Layer.empty }))),
      Effect.bind("counter", ({ running }) => Scope.extend(State.create(Counter, { count: 0 }), running.runtime.scope)),
      Effect.let("fiber", ({ running, counter }) => Runtime.runFork(running.runtime, Stream.runCollect(counter.changes))),
      Effect.tap(() => Effect.sleep("1 millis")),
      Effect.tap(({ counter }) => State.set(counter, { count: 1 })),
      Effect.tap(({ running }) => Application.shutdown(running)),
      Effect.andThen(({ fiber }) => Fiber.await(fiber).pipe(Effect.timeout(Duration.seconds(1))))
    )));

    expect(exit).is.satisfies(Exit.isSuccess);
    expect(Exit.isSuccess(exit) && Array.from(exit.value)).toEqual([{ count: 1 }]);
  });
});
