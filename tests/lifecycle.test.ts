// v0.3: the application lifecycle (N1, N2) and application-owned State (D1).
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, ParseResult, Ref, Schedule, Schema, Scope, Stream, Runtime as EffectRuntime } from "effect";
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

// A Number schema whose decode signals `entered`, then waits for `gate`. A
// createState using it holds the runtime's admission until the test opens the gate.
const gatedNumber = (entered: Deferred.Deferred<void>, gate: Deferred.Deferred<void>) => Schema.transformOrFail(Schema.Number, Schema.Number, {
  strict: true,
  decode: (n) => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)), Effect.as(n)),
  encode: (n) => ParseResult.succeed(n),
});

// An application whose one resource counts its release, signals `releasing`, and
// then holds termination in `Stopping` until `gate` opens.
const gatedRelease = (releases: Ref.Ref<number>, releasing: Deferred.Deferred<void>, gate: Deferred.Deferred<void>) => Application.define({
  name: "gated",
  runtime: Layer.scopedDiscard(Effect.addFinalizer(() => Ref.update(releases, (n) => n + 1).pipe(
    Effect.andThen(Deferred.succeed(releasing, undefined)),
    Effect.andThen(Deferred.await(gate))
  ))),
});

// Lets forked fibers run until they block. Scheduling, not time: no sleeps.
const settle = Effect.repeatN(Effect.yieldNow(), 20);

// Route 1 or route 2, as an effect, for one application and its caller's start scope.
const terminateBy = <R>(route: "shutdown" | "scope", running: Application.RunningApplication<R>, scope: Scope.CloseableScope) =>
  route === "shutdown" ? Application.shutdown(running) : Scope.close(scope, Exit.void);

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

  it("lets an admitted construction request another while Running, without deadlock", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("running", () => Application.start(Application.define({ name: "nested", runtime: Layer.empty }))),
      Effect.bind("nested", () => Deferred.make<Exit.Exit<StateHandle<{ readonly count: number }>, StateInitError>>()),
      Effect.let("reentrant", ({ running, nested }) => Schema.transformOrFail(Schema.Number, Schema.Number, {
        strict: true,
        decode: (n) => Effect.exit(Application.createState(running, Counter, { count: 0 })).pipe(Effect.flatMap((exit) => Deferred.succeed(nested, exit)), Effect.as(n)),
        encode: (n) => ParseResult.succeed(n),
      })),
      Effect.bind("outer", ({ running, reentrant }) => Effect.exit(Application.createState(running, reentrant, 1).pipe(Effect.timeout(Duration.seconds(1))))),
      Effect.bind("inner", ({ nested }) => Deferred.await(nested).pipe(Effect.timeout(Duration.seconds(1))))
    )));

    expect(Exit.isSuccess(result.outer)).toBe(true);
    expect(Exit.isSuccess(result.inner)).toBe(true);
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

  // B1: construction holding admission when termination is requested. Deterministic: gates, no randomness.
  for (const route of ["shutdown", "scope"] as const) {
    it(`construction holding admission finishes first; termination waits, then refuses new work from Stopping (route ${route === "shutdown" ? "1" : "2"})`, async () => {
      let ran = false;

      const result = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("releases", () => Ref.make(0)),
        Effect.bind("releasing", () => Deferred.make<void>()),
        Effect.bind("releaseGate", () => Deferred.make<void>()),
        Effect.bind("entered", () => Deferred.make<void>()),
        Effect.bind("decodeGate", () => Deferred.make<void>()),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("running", ({ scope, releases, releasing, releaseGate }) => Scope.extend(Application.start(gatedRelease(releases, releasing, releaseGate)), scope)),
        // Construction is admitted, and holds admission inside its decode.
        Effect.bind("creating", ({ running, entered, decodeGate }) => Effect.fork(Effect.exit(Application.createState(running, gatedNumber(entered, decodeGate), 1)))),
        Effect.tap(({ entered }) => Deferred.await(entered)),
        Effect.bind("terminating", ({ running, scope }) => Effect.fork(terminateBy(route, running, scope))),
        // A construction requested once termination has been claimed is refused at once.
        Effect.bind("late", ({ running }) => Effect.fork(Effect.exit(Application.createState(running, Counter, { count: 0 })))),
        Effect.tap(() => settle),
        // Termination is waiting for the admitted construction: it hasn't begun.
        Effect.bind("statusWhileAdmitted", ({ running }) => Application.status(running)),
        Effect.bind("terminatingWhileAdmitted", ({ terminating }) => Fiber.poll(terminating)),
        Effect.bind("lateWhileAdmitted", ({ late }) => Fiber.poll(late)),
        Effect.bind("releasedWhileAdmitted", ({ releases }) => Ref.get(releases))
      ).pipe(
        Effect.tap(({ decodeGate }) => Deferred.succeed(decodeGate, undefined)),
        Effect.bind("created", ({ creating }) => Fiber.join(creating)),
        // Termination has begun and is releasing: the application is Stopping.
        Effect.tap(({ releasing }) => Deferred.await(releasing)),
        Effect.bind("statusAtStopping", ({ running }) => Application.status(running)),
        Effect.bind("forkAtStopping", ({ running }) => Fiber.await(Runtime.runFork(running.runtime, Effect.sync(() => { ran = true; })))),
        Effect.bind("createAtStopping", ({ running }) => Effect.exit(Application.createState(running, Counter, { count: 0 }))),
        Effect.bind("lateExit", ({ late }) => Fiber.join(late)),
        Effect.tap(({ releaseGate }) => Deferred.succeed(releaseGate, undefined)),
        Effect.tap(({ terminating }) => Fiber.join(terminating)),
        Effect.bind("changesEnd", ({ created }): Effect.Effect<Exit.Exit<unknown, unknown>> => Exit.isSuccess(created)
          ? Effect.exit(Stream.runDrain(created.value.changes).pipe(Effect.timeout(Duration.seconds(1))))
          : Effect.succeed(Exit.fail("not created"))),
        Effect.bind("finalStatus", ({ running }) => Application.status(running)),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.bind("released", ({ releases }) => Ref.get(releases))
      ));

      expect(result.statusWhileAdmitted).toEqual({ _tag: "Running" });
      expect(Option.isNone(result.terminatingWhileAdmitted)).toBe(true);
      // The late fiber has already finished (it wasn't left waiting), and its construction was refused.
      expect(Option.map(result.lateWhileAdmitted, (fiberExit) => Exit.isSuccess(fiberExit) && isRefusal(fiberExit.value))).toEqual(Option.some(true));
      expect(result.releasedWhileAdmitted).toBe(0);
      expect(Exit.isSuccess(result.created)).toBe(true);
      expect(result.statusAtStopping).toEqual({ _tag: "Stopping" });
      expect(isRefusal(result.forkAtStopping)).toBe(true);
      expect(ran).toBe(false);
      expect(isRefusal(result.createAtStopping)).toBe(true);
      expect(isRefusal(result.lateExit)).toBe(true);
      expect(Exit.isSuccess(result.changesEnd)).toBe(true);
      expect(result.finalStatus).toEqual({ _tag: "Stopped" });
      expect(result.released).toBe(1);
    });

    it(`run and runFork issued while termination waits for admitted work are refused and never execute (route ${route === "shutdown" ? "1" : "2"})`, async () => {
      let ranViaRun = false;
      let ranViaFork = false;

      const result = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("releases", () => Ref.make(0)),
        Effect.bind("releasing", () => Deferred.make<void>()),
        Effect.bind("releaseGate", () => Deferred.make<void>()),
        Effect.bind("entered", () => Deferred.make<void>()),
        Effect.bind("decodeGate", () => Deferred.make<void>()),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("running", ({ scope, releases, releasing, releaseGate }) => Scope.extend(Application.start(gatedRelease(releases, releasing, releaseGate)), scope)),
        // 1. An admitted createState holds admission inside its decode.
        Effect.bind("creating", ({ running, entered, decodeGate }) => Effect.fork(Effect.exit(Application.createState(running, gatedNumber(entered, decodeGate), 1)))),
        Effect.tap(({ entered }) => Deferred.await(entered)),
        // 2. Termination is claimed, and waits for that admitted work.
        Effect.bind("terminating", ({ running, scope }) => Effect.fork(terminateBy(route, running, scope))),
        Effect.tap(() => settle),
        Effect.bind("statusWhileWaiting", ({ running }) => Application.status(running)),
        Effect.bind("terminatingWhileWaiting", ({ terminating }) => Fiber.poll(terminating)),
        // 3–4. New work issued while termination waits.
        Effect.bind("runExit", ({ running }) => Effect.promise(() => Runtime.run(running.runtime, Effect.sync(() => { ranViaRun = true; })).then(
          () => Exit.void,
          (error: unknown) => EffectRuntime.isFiberFailure(error) ? Exit.failCause(error[EffectRuntime.FiberFailureCauseId]) : Exit.die(error)
        ))),
        Effect.bind("forkExit", ({ running }) => Fiber.await(Runtime.runFork(running.runtime, Effect.sync(() => { ranViaFork = true; }))))
      ).pipe(
        // 5. The admitted work finishes; 6. termination proceeds.
        Effect.tap(({ decodeGate }) => Deferred.succeed(decodeGate, undefined)),
        Effect.bind("created", ({ creating }) => Fiber.join(creating)),
        Effect.tap(({ releasing }) => Deferred.await(releasing)),
        Effect.tap(({ releaseGate }) => Deferred.succeed(releaseGate, undefined)),
        Effect.tap(({ terminating }) => Fiber.join(terminating)),
        Effect.bind("finalStatus", ({ running }) => Application.status(running)),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.bind("released", ({ releases }) => Ref.get(releases))
      ));

      expect(result.statusWhileWaiting).toEqual({ _tag: "Running" });
      expect(Option.isNone(result.terminatingWhileWaiting)).toBe(true);
      expect(isRefusal(result.runExit)).toBe(true);
      expect(isRefusal(result.forkExit)).toBe(true);
      expect(ranViaRun).toBe(false);
      expect(ranViaFork).toBe(false);
      expect(Exit.isSuccess(result.created)).toBe(true);
      expect(result.finalStatus).toEqual({ _tag: "Stopped" });
      expect(result.released).toBe(1);
    });

    it(`an admitted construction that requests another once termination is claimed is refused, not deadlocked (route ${route === "shutdown" ? "1" : "2"})`, async () => {
      const result = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("entered", () => Deferred.make<void>()),
        Effect.bind("decodeGate", () => Deferred.make<void>()),
        Effect.bind("nested", () => Deferred.make<Exit.Exit<StateHandle<{ readonly count: number }>, StateInitError>>()),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("running", ({ scope }) => Scope.extend(Application.start(Application.define({ name: "nested", runtime: Layer.empty })), scope)),
        // The outer construction's decode, once released, requests a second, nested construction.
        Effect.let("reentrant", ({ running, entered, decodeGate, nested }) => Schema.transformOrFail(Schema.Number, Schema.Number, {
          strict: true,
          decode: (n) => Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(decodeGate)),
            Effect.andThen(Effect.exit(Application.createState(running, Counter, { count: 0 }))),
            Effect.flatMap((exit) => Deferred.succeed(nested, exit)),
            Effect.as(n)
          ),
          encode: (n) => ParseResult.succeed(n),
        })),
        Effect.bind("creating", ({ running, reentrant }) => Effect.fork(Effect.exit(Application.createState(running, reentrant, 1)))),
        Effect.tap(({ entered }) => Deferred.await(entered)),
        Effect.bind("terminating", ({ running, scope }) => Effect.fork(terminateBy(route, running, scope))),
        Effect.tap(() => settle),
        Effect.tap(({ decodeGate }) => Deferred.succeed(decodeGate, undefined)),
        Effect.bind("nestedExit", ({ nested }) => Deferred.await(nested)),
        Effect.bind("created", ({ creating }) => Fiber.join(creating)),
        Effect.bind("terminated", ({ terminating }) => Fiber.await(terminating)),
        Effect.bind("finalStatus", ({ running }) => Application.status(running)),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void))
      ));

      expect(isRefusal(result.nestedExit)).toBe(true);
      expect(Exit.isSuccess(result.created)).toBe(true);
      expect(Exit.isSuccess(result.terminated)).toBe(true);
      expect(result.finalStatus).toEqual({ _tag: "Stopped" });
    });

    it(`construction requested once termination has begun is refused (route ${route === "shutdown" ? "1" : "2"})`, async () => {
      const result = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("releases", () => Ref.make(0)),
        Effect.bind("releasing", () => Deferred.make<void>()),
        Effect.bind("releaseGate", () => Deferred.make<void>()),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("running", ({ scope, releases, releasing, releaseGate }) => Scope.extend(Application.start(gatedRelease(releases, releasing, releaseGate)), scope)),
        Effect.bind("terminating", ({ running, scope }) => Effect.fork(terminateBy(route, running, scope))),
        // Termination has begun and is held in Stopping by the gated release.
        Effect.tap(({ releasing }) => Deferred.await(releasing)),
        Effect.bind("statusAtStopping", ({ running }) => Application.status(running)),
        Effect.bind("construction", ({ running }) => Effect.exit(Application.createState(running, Counter, { count: 0 }))),
        Effect.tap(({ releaseGate }) => Deferred.succeed(releaseGate, undefined)),
        Effect.tap(({ terminating }) => Fiber.join(terminating)),
        Effect.bind("finalStatus", ({ running }) => Application.status(running)),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.bind("released", ({ releases }) => Ref.get(releases))
      ));

      expect(result.statusAtStopping).toEqual({ _tag: "Stopping" });
      expect(isRefusal(result.construction)).toBe(true);
      expect(result.finalStatus).toEqual({ _tag: "Stopped" });
      expect(result.released).toBe(1);
    });
  }
});

