// v0.3: the application lifecycle (N1, N2) and application-owned State (D1).
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Ref, Schedule, Schema, Scope, Stream, Runtime as EffectRuntime } from "effect";
import { describe, expect, it } from "vitest";

import * as Application from "../src/application/index.js";
import * as Event from "../src/event/index.js";
import * as Runtime from "../src/runtime/index.js";
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
