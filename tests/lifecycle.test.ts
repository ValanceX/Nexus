// v0.3: the application lifecycle (N1, N2) and application-owned State (D1).
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Ref, Schedule, Schema, Scope, Stream, Runtime as EffectRuntime } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as Application from "../src/application/index.js";
import * as Event from "../src/event/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Selector from "../src/selector/index.js";
import type { StateHandle, StateInitError } from "../src/state/index.js";
import * as Service from "../src/service/index.js";

const Ping = Event.define("Ping", Schema.Struct({ n: Schema.Number }));

// Waits, boundedly, until `get` satisfies `done`.
const eventually = <A>(get: Effect.Effect<A>, done: (a: A) => boolean): Effect.Effect<A, unknown> =>
  get.pipe(Effect.filterOrFail(done), Effect.retry(Schedule.spaced("1 millis")), Effect.timeout(Duration.seconds(1)));

// A refused call: a die, and no typed failure.
const isRefusal = <A, E>(exit: Exit.Exit<A, E>) => Exit.isFailure(exit) && Cause.isDie(exit.cause) && Option.isNone(Cause.failureOption(exit.cause));

// An application whose one resource counts its releases.
const counted = (releases: Ref.Ref<number>) => Application.define({
  name: "counted",
  runtime: Layer.scopedDiscard(Effect.addFinalizer(() => Ref.update(releases, (n) => n + 1))),
});

// Records each change of status, until interrupted.
const sampleStatus = <R>(running: Application.RunningApplication<R>, seen: Ref.Ref<ReadonlyArray<string>>) => Effect.forkDaemon(Effect.forever(
  Application.status(running).pipe(
    Effect.flatMap((status) => Ref.update(seen, (xs) => xs.at(-1) === status._tag ? xs : [...xs, status._tag])),
    Effect.andThen(Effect.yieldNow())
  )
));

const order = ["Running", "Stopping", "Stopped"];
const isMonotonic = (statuses: ReadonlyArray<string>) => statuses.every((status, i) => i === 0 || order.indexOf(status) > order.indexOf(statuses[i - 1] ?? ""));

describe("Application lifecycle (N2)", () => {
  it("route 1: Application.shutdown stops, releases once, ends subscriptions and refuses later work", async () => {
    let ran = false;

    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("releases", () => Ref.make(0)),
      Effect.bind("running", ({ releases }) => Application.start(counted(releases))),
      Effect.let("consumer", ({ running }) => Runtime.runFork(running.runtime, Stream.runDrain(Event.subscribe(Ping)))),
      Effect.tap(() => Effect.sleep("1 millis")),
      Effect.tap(({ running }) => Application.shutdown(running)),
      Effect.bind("status", ({ running }) => Application.status(running)),
      Effect.bind("released", ({ releases }) => Ref.get(releases)),
      Effect.bind("consumerExit", ({ consumer }) => Fiber.await(consumer).pipe(Effect.timeout(Duration.seconds(1)))),
      Effect.bind("runExit", ({ running }) => Effect.promise(() => Runtime.run(running.runtime, Effect.sync(() => { ran = true; })).then(
        () => Exit.void,
        (error: unknown) => EffectRuntime.isFiberFailure(error) ? Exit.failCause(error[EffectRuntime.FiberFailureCauseId]) : Exit.die(error)
      ))),
      Effect.bind("forkExit", ({ running }) => Fiber.await(Runtime.runFork(running.runtime, Effect.sync(() => { ran = true; }))))
    )));

    expect(result.status).toEqual({ _tag: "Stopped" });
    expect(result.released).toBe(1);
    expect(Exit.isSuccess(result.consumerExit)).toBe(true);
    expect(isRefusal(result.runExit)).toBe(true);
    expect(isRefusal(result.forkExit)).toBe(true);
    expect(ran).toBe(false);
  });

  it("route 2: closing the caller's start scope stops the application the same way (P7)", async () => {
    const result = await Effect.runPromise(Effect.Do.pipe(
      Effect.bind("releases", () => Ref.make(0)),
      Effect.bind("scope", () => Scope.make()),
      Effect.bind("running", ({ scope, releases }) => Scope.extend(Application.start(counted(releases)), scope)),
      Effect.let("consumer", ({ running }) => Runtime.runFork(running.runtime, Stream.runDrain(Event.subscribe(Ping)))),
      Effect.tap(() => Effect.sleep("1 millis")),
      Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
      Effect.bind("status", ({ running }) => Application.status(running)),
      Effect.bind("consumerExit", ({ consumer }) => Fiber.await(consumer).pipe(Effect.timeout(Duration.seconds(1)))),
      Effect.tap(({ running }) => Application.shutdown(running)),
      Effect.bind("statusAfterShutdown", ({ running }) => Application.status(running)),
      Effect.bind("released", ({ releases }) => Ref.get(releases))
    ));

    expect(result.status).toEqual({ _tag: "Stopped" });
    expect(Exit.isSuccess(result.consumerExit)).toBe(true);
    expect(result.statusAfterShutdown).toEqual({ _tag: "Stopped" });
    expect(result.released).toBe(1);
  });

  it("has exactly one initialization failure: ServiceGraphFailed", () => {
    expectTypeOf<Application.ApplicationInitError["_tag"]>().toEqualTypeOf<"ServiceGraphFailed">();
  });

  it("a failed start is a typed ServiceGraphFailed, with no handle, and releases what it built", async () => {
    interface BrokenShape { readonly value: number }

    const Broken = Service.define<BrokenShape>("Broken");
    const acquired = { count: 0, released: 0 };
    const AcquiredLive = Layer.scopedDiscard(Effect.acquireRelease(
      Effect.sync(() => { acquired.count += 1; }),
      () => Effect.sync(() => { acquired.released += 1; })
    ));
    // Acquired is built first; Broken then fails.
    const BrokenLive = Layer.provideMerge(Layer.effect(Broken, Effect.fail("boom" as const)), AcquiredLive) as unknown as Layer.Layer<BrokenShape, unknown, never>;

    const error = await Effect.runPromise(Effect.scoped(Effect.flip(Application.start(Application.define({ name: "broken", runtime: BrokenLive })))));

    expect(error._tag).toBe("ServiceGraphFailed");
    expect(acquired).toEqual({ count: 1, released: 1 });
  });

  it("repeated shutdown never moves status after Stopped", async () => {
    const statuses = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("releases", () => Ref.make(0)),
      Effect.bind("running", ({ releases }) => Application.start(counted(releases))),
      Effect.bind("seen", () => Ref.make<ReadonlyArray<string>>([])),
      Effect.bind("sampler", ({ running, seen }) => sampleStatus(running, seen)),
      Effect.tap(({ running }) => Application.shutdown(running)),
      Effect.tap(({ running }) => Application.shutdown(running)),
      Effect.tap(({ running }) => Application.shutdown(running)),
      Effect.tap(() => Effect.sleep("5 millis")),
      Effect.tap(({ sampler }) => Fiber.interrupt(sampler)),
      Effect.flatMap(({ seen }) => Ref.get(seen))
    )));

    expect(statuses.at(-1)).toBe("Stopped");
    expect(isMonotonic(statuses)).toBe(true);
  });

  it("concurrent shutdowns, racing route 2, terminate once and all return at Stopped", async () => {
    for (let i = 0; i < 100; i++) {
      const result = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("releases", () => Ref.make(0)),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("running", ({ scope, releases }) => Scope.extend(Application.start(counted(releases)), scope)),
        Effect.bind("seen", () => Ref.make<ReadonlyArray<string>>([])),
        Effect.bind("sampler", ({ running, seen }) => sampleStatus(running, seen)),
        Effect.bind("returned", ({ running, scope }) => Effect.all([
          ...Array.from({ length: 10 }, () => Application.shutdown(running).pipe(Effect.andThen(Application.status(running)))),
          Scope.close(scope, Exit.void).pipe(Effect.andThen(Application.status(running))),
        ], { concurrency: "unbounded" })),
        Effect.tap(({ sampler }) => Fiber.interrupt(sampler)),
        Effect.bind("released", ({ releases }) => Ref.get(releases)),
        Effect.bind("statuses", ({ seen }) => Ref.get(seen))
      ));

      expect(result.released).toBe(1);
      expect(result.returned.every((status) => status._tag === "Stopped")).toBe(true);
      expect(isMonotonic(result.statuses)).toBe(true);
    }
  });

  it("a concurrent shutdown returns only once the application is Stopped", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("releasing", () => Deferred.make<void>()),
      Effect.bind("gate", () => Deferred.make<void>()),
      Effect.bind("running", ({ releasing, gate }) => Application.start(Application.define({
        name: "gated",
        runtime: Layer.scopedDiscard(Effect.addFinalizer(() => Deferred.succeed(releasing, undefined).pipe(Effect.andThen(Deferred.await(gate))))),
      }))),
      Effect.bind("first", ({ running }) => Effect.fork(Application.shutdown(running))),
      Effect.tap(({ releasing }) => Deferred.await(releasing)),
      Effect.bind("second", ({ running }) => Effect.fork(Application.shutdown(running).pipe(Effect.andThen(Application.status(running))))),
      Effect.tap(() => Effect.repeatN(Effect.yieldNow(), 20)),
      Effect.bind("secondBeforeRelease", ({ second }) => Fiber.poll(second)),
      Effect.tap(({ gate }) => Deferred.succeed(gate, undefined)),
      Effect.tap(({ first }) => Fiber.join(first)),
      Effect.bind("secondReturnedAt", ({ second }) => Fiber.join(second))
    )));

    expect(Option.isNone(result.secondBeforeRelease)).toBe(true);
    expect(result.secondReturnedAt).toEqual({ _tag: "Stopped" });
  });

  it("refuses new work while Stopping", async () => {
    let ran = false;

    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("releasing", () => Deferred.make<void>()),
      Effect.bind("gate", () => Deferred.make<void>()),
      Effect.bind("running", ({ releasing, gate }) => Application.start(Application.define({
        name: "gated",
        runtime: Layer.scopedDiscard(Effect.addFinalizer(() => Deferred.succeed(releasing, undefined).pipe(Effect.andThen(Deferred.await(gate))))),
      }))),
      Effect.bind("stopping", ({ running }) => Effect.fork(Application.shutdown(running))),
      Effect.tap(({ releasing }) => Deferred.await(releasing)),
      Effect.bind("statusWhileStopping", ({ running }) => Application.status(running)),
      Effect.bind("forkExit", ({ running }) => Fiber.await(Runtime.runFork(running.runtime, Effect.sync(() => { ran = true; })))),
      Effect.tap(({ gate }) => Deferred.succeed(gate, undefined)),
      Effect.tap(({ stopping }) => Fiber.join(stopping)),
      Effect.bind("statusAfter", ({ running }) => Application.status(running))
    )));

    expect(result.statusWhileStopping).toEqual({ _tag: "Stopping" });
    expect(isRefusal(result.forkExit)).toBe(true);
    expect(ran).toBe(false);
    expect(result.statusAfter).toEqual({ _tag: "Stopped" });
  });

  it("exposes only status, runtime and environment", async () => {
    const keys = await Effect.runPromise(Effect.scoped(Effect.map(Application.start(Application.define({ name: "shape", runtime: Layer.empty })), (running) => {
      // @ts-expect-error: shutdown goes through Application.shutdown only
      void running.shutdown;

      return Reflect.ownKeys(running).map(String).sort();
    })));

    expect(keys).toEqual(["environment", "runtime", "status"]);
  });
});

const Counter = Schema.Struct({ count: Schema.Number });

// 0–3 scheduler yields, so each side of a race may start first.
const jitter = Effect.suspend(() => Effect.repeatN(Effect.yieldNow(), Math.floor(Math.random() * 4)));

describe("Application-owned State (D1, Q2 = A)", () => {
  it("lives in the application: its changes and a derived selector end on either route", async () => {
    for (const route of ["shutdown", "scope"] as const) {
      const exits = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("running", ({ scope }) => Scope.extend(Application.start(Application.define({ name: "owner", runtime: Layer.empty })), scope)),
        Effect.bind("counter", ({ running }) => Application.createState(running, Counter, { count: 0 })),
        Effect.bind("changes", ({ counter }) => Effect.forkDaemon(Stream.runDrain(counter.changes))),
        Effect.bind("derived", ({ counter }) => Effect.forkDaemon(Stream.runDrain(Selector.define(counter, (c) => c.count).changes))),
        Effect.tap(({ running, scope }) => route === "shutdown" ? Application.shutdown(running) : Scope.close(scope, Exit.void)),
        Effect.bind("changesExit", ({ changes }) => Fiber.await(changes).pipe(Effect.timeout(Duration.seconds(1)))),
        Effect.bind("derivedExit", ({ derived }) => Fiber.await(derived).pipe(Effect.timeout(Duration.seconds(1)))),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void))
      ));

      expect(Exit.isSuccess(exits.changesExit)).toBe(true);
      expect(Exit.isSuccess(exits.derivedExit)).toBe(true);
    }
  });

  it("keeps StateInitError typed, and is the only error in its channel", async () => {
    expectTypeOf<Effect.Effect.Error<ReturnType<typeof Application.createState<never, { readonly count: number }>>>>().toEqualTypeOf<StateInitError>();
    expectTypeOf<Effect.Effect.Context<ReturnType<typeof Application.createState<never, { readonly count: number }>>>>().toEqualTypeOf<never>();

    const error = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("running", () => Application.start(Application.define({ name: "typed", runtime: Layer.empty }))),
      Effect.flatMap(({ running }) => Effect.flip(Application.createState(running, Counter, { count: "nope" } as unknown as { count: number })))
    )));

    expect(error._tag).toBe("InitialValueInvalid");
  });

  it("refuses construction, as a defect, while Stopping and once Stopped", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("releasing", () => Deferred.make<void>()),
      Effect.bind("gate", () => Deferred.make<void>()),
      Effect.bind("running", ({ releasing, gate }) => Application.start(Application.define({
        name: "gated",
        runtime: Layer.scopedDiscard(Effect.addFinalizer(() => Deferred.succeed(releasing, undefined).pipe(Effect.andThen(Deferred.await(gate))))),
      }))),
      Effect.bind("stopping", ({ running }) => Effect.fork(Application.shutdown(running))),
      Effect.tap(({ releasing }) => Deferred.await(releasing)),
      Effect.bind("whileStopping", ({ running }) => Effect.exit(Application.createState(running, Counter, { count: 0 }))),
      Effect.tap(({ gate }) => Deferred.succeed(gate, undefined)),
      Effect.tap(({ stopping }) => Fiber.join(stopping)),
      Effect.bind("onceStopped", ({ running }) => Effect.exit(Application.createState(running, Counter, { count: 0 })))
    )));

    expect(isRefusal(result.whileStopping)).toBe(true);
    expect(isRefusal(result.onceStopped)).toBe(true);
  });

  it("racing termination, either creates a State that ends with the application or refuses: never a third outcome", async () => {
    const outcomes = { created: 0, refused: 0 };

    for (const route of ["shutdown", "scope"] as const) {
      for (let i = 0; i < 200; i++) {
        const outcome = await Effect.runPromise(Effect.Do.pipe(
          Effect.bind("scope", () => Scope.make()),
          Effect.bind("running", ({ scope }) => Scope.extend(Application.start(Application.define({ name: "race", runtime: Layer.empty })), scope)),
          Effect.bind("raced", ({ running, scope }) => Effect.all([
            jitter.pipe(Effect.andThen(Effect.exit(Application.createState(running, Counter, { count: 0 })))),
            jitter.pipe(Effect.andThen(route === "shutdown" ? Application.shutdown(running) : Scope.close(scope, Exit.void))),
          ], { concurrency: "unbounded" })),
          Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
          Effect.flatMap(({ raced: [exit] }): Effect.Effect<"created" | "refused" | "other", unknown> => {
            if (Exit.isSuccess(exit)) {
              // A created State is bound to the (now stopped) application, so its changes have ended.
              const state: StateHandle<{ readonly count: number }> = exit.value;

              return Stream.runDrain(state.changes).pipe(Effect.timeout(Duration.seconds(1)), Effect.as("created" as const));
            }

            return Effect.succeed(isRefusal(exit) ? "refused" as const : "other" as const);
          })
        ));

        expect(outcome).not.toBe("other");
        outcomes[outcome as "created" | "refused"] += 1;
      }
    }

    // Both sides of the race were exercised.
    expect(outcomes.created).toBeGreaterThan(0);
    expect(outcomes.refused).toBeGreaterThan(0);
  });
});

