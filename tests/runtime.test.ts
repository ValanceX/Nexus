import { Cause, Chunk, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Ref, Schedule, Schema, Scope, Stream, Runtime as EffectRuntime } from "effect";
import { describe, it, expect } from "vitest";

import * as Event from "../src/event/index.js";
import * as Runtime from "../src/runtime/index.js";
import { terminate } from "../src/runtime/internal.js";
import * as Service from "../src/service/index.js";

interface ClockShape { readonly now: () => number }
const Clock = Service.define<ClockShape>("Clock");
const ClockLive = Service.layerSync(Clock, () => ({ now: () => 99 }));

describe("Runtime", () => {
  it("executes an effect against the built service graph", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(() => Runtime.make(ClockLive)),
      Effect.andThen((runtime) => Effect.promise(() => Runtime.run(runtime, Effect.map(Clock, (c) => c.now()))))
    )));

    expect(result).toBe(99);
  });

  it("feeds its own event bus into the layer's requirements and keeps it reachable", async () => {
    interface NotifierShape {
      readonly notify: (n: number) => Effect.Effect<void>
    }

    const Ping = Event.define("Ping", Schema.Struct({ n: Schema.Number }));
    const Notifier = Service.define<NotifierShape>("Notifier");

    // The layer declares EventBusShape as an INPUT requirement; Runtime.make
    // satisfies it with the runtime's own bus (provide), and the same bus stays
    // in the built context (merge), so Event.subscribe works through the runtime.
    const NotifierLive: Layer.Layer<NotifierShape, never, Event.EventBusShape> = Layer.effect(
      Notifier,
      Effect.map(Effect.context<Event.EventBusShape>(), (bus) => ({
        notify: (n: number) => Event.publish(Ping, { n }).pipe(Effect.provide(bus)),
      }))
    );

    const events = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind('runtime', () => Runtime.make(NotifierLive)),
      Effect.let('fiber', ({ runtime }) => Runtime.runFork(runtime, Stream.runCollect(Stream.take(Event.subscribe(Ping), 1)))),
      Effect.andThen(({ runtime, fiber }) => Effect.Do.pipe(
        Effect.andThen(Effect.sleep('1 millis')),
        Effect.andThen(Effect.promise(() => Runtime.run(runtime, Effect.flatMap(Notifier, (n) => n.notify(7))))),
        Effect.andThen(Fiber.join(fiber))
      ))
    )));

    expect(Array.from(Chunk.toReadonlyArray(events))).toEqual([{ n: 7 }]);
  });

  it("interrupting a runFork fiber stops the running effect and runs its finalizer", async () => {
    let cleaned = false;

    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Runtime.make(ClockLive)),
      Effect.map((runtime) => Runtime.runFork(
        runtime,
        Effect.acquireUseRelease(
          Effect.succeed("held"),
          () => Effect.never,
          () => Effect.sync(() => { cleaned = true; })
        )
      )),
      Effect.andThen((fiber) => Effect.Do.pipe(
        Effect.andThen(Effect.sleep('10 millis')),
        Effect.andThen(Fiber.interrupt(fiber)),
        Effect.map(() => cleaned)
      ))
    )));

    expect(result).toBe(true);
  });

  it("shutdown releases resources acquired through the service graph", async () => {
    interface HeldShape { readonly held: boolean }

    let released = false;

    const Held = Service.define<HeldShape>("Held");
    const HeldLive = Layer.scoped(
      Held,
      Effect.acquireRelease(Effect.succeed({ held: true }), () => Effect.sync(() => { released = true; }))
    );

    // A standalone runtime ends when the Scope its owner passed to make closes.
    await Effect.runPromise(Effect.Do.pipe(
      Effect.bind("scope", () => Scope.make()),
      Effect.tap(({ scope }) => Scope.extend(Runtime.make(HeldLive), scope)),
      Effect.tap(({ scope }) => Scope.close(scope, Exit.void))
    ));

    expect(released).toBe(true);
  });

  it("reports a typed RuntimeInitError when the layer fails to build", async () => {
    interface BrokenShape { readonly x: number }
    const Broken = Service.define<BrokenShape>("Broken");
    const BrokenLive = Layer.effect(Broken, Effect.fail("boom" as const));

    const exit = await Effect.runPromiseExit(
      Effect.scoped(Runtime.make(BrokenLive as unknown as Layer.Layer<BrokenShape, unknown, never>))
    );

    expect(exit).is.satisfies(Exit.isFailure);
  });

  describe("the opaque handle (N3)", () => {
    // Every value reachable from `root` through own keys (symbols included).
    const reachable = (root: unknown): ReadonlyArray<unknown> => {
      const seen = new Set<unknown>();
      const walk = (value: unknown, depth: number): void => {
        if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value) || depth > 6) {
          return;
        }

        seen.add(value);

        for (const key of Reflect.ownKeys(value)) {
          walk((value as Record<PropertyKey, unknown>)[key], depth + 1);
        }
      };

      walk(root, 0);

      return Array.from(seen);
    };

    const isScope = (value: unknown) => typeof value === "object" && value !== null && Scope.ScopeTypeId in value;
    const isEffectRuntime = (value: unknown) => typeof value === "object" && value !== null && "runtimeFlags" in value && "fiberRefs" in value;

    it("exposes no scope, Effect runtime or context, by type or at runtime", async () => {
      const found = await Effect.runPromise(Effect.scoped(Effect.map(Runtime.make(ClockLive), (runtime) => {
        // @ts-expect-error: the handle has no scope (P3)
        void runtime.scope;
        // @ts-expect-error: the handle has no Effect runtime (P4)
        void runtime.runtime;
        // @ts-expect-error: the handle has no context (P4)
        void runtime.context;

        return {
          keys: Reflect.ownKeys(runtime),
          leaks: reachable(runtime).filter((value) => Context.isContext(value) || isScope(value) || isEffectRuntime(value)).length,
        };
      })));

      expect(found).toEqual({ keys: [], leaks: 0 });
    });

    it("has no public shutdown (P9)", () => {
      // @ts-expect-error: a runtime ends only when its owner's scope closes
      expect(Runtime.shutdown).toBeUndefined();
    });

    it("still executes effects against the service graph through run and runFork", async () => {
      const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
        Effect.bind("runtime", () => Runtime.make(ClockLive)),
        Effect.bind("viaRun", ({ runtime }) => Effect.promise(() => Runtime.run(runtime, Effect.map(Clock, (c) => c.now())))),
        Effect.bind("viaFork", ({ runtime }) => Fiber.join(Runtime.runFork(runtime, Effect.map(Clock, (c) => c.now() + 1)))),
        Effect.map(({ viaRun, viaFork }) => [viaRun, viaFork])
      )));

      expect(result).toEqual([99, 100]);
    });

    it("refuses a handle it didn't make, as a defect, without running the effect", async () => {
      let ran = false;
      const forged = Object.freeze({}) as unknown as Runtime.NexusRuntime<never>;
      const rejection = await Runtime.run(forged, Effect.sync(() => { ran = true; })).then(() => undefined, (error: unknown) => error);

      expect(ran).toBe(false);
      expect(EffectRuntime.isFiberFailure(rejection)).toBe(true);
      expect(EffectRuntime.isFiberFailure(rejection) && Cause.isDie(rejection[EffectRuntime.FiberFailureCauseId])).toBe(true);
    });
  });

  describe("termination (Q1, D4)", () => {
    const eventually = <A>(get: Effect.Effect<A>, done: (a: A) => boolean): Effect.Effect<A, unknown> =>
      get.pipe(Effect.filterOrFail(done), Effect.retry(Schedule.spaced("1 millis")), Effect.timeout(Duration.seconds(1)));

    // The defect a refused call ends with: a die, and no typed failure.
    const isRefusal = <A, E>(exit: Exit.Exit<A, E>) => Exit.isFailure(exit) && Cause.isDie(exit.cause) && Option.isNone(Cause.failureOption(exit.cause));

    const Ping = Event.define("Ping", Schema.Struct({ n: Schema.Number }));

    it("refuses run and runFork once the owning scope has closed, without starting the effect", async () => {
      let ran = false;

      const { runRejection, forkExit } = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("runtime", ({ scope }) => Scope.extend(Runtime.make(ClockLive), scope)),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.bind("runRejection", ({ runtime }) => Effect.promise(() => Runtime.run(runtime, Effect.sync(() => { ran = true; })).then(() => undefined, (error: unknown) => error))),
        Effect.bind("forkExit", ({ runtime }) => Fiber.await(Runtime.runFork(runtime, Effect.sync(() => { ran = true; }))))
      ));

      expect(ran).toBe(false);
      expect(EffectRuntime.isFiberFailure(runRejection) && Cause.isDie(runRejection[EffectRuntime.FiberFailureCauseId])).toBe(true);
      expect(isRefusal(forkExit)).toBe(true);
    });

    it("refuses new work from the moment termination begins, before release completes", async () => {
      let ran = false;

      const refused = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("releasing", () => Deferred.make<void>()),
        Effect.bind("gate", () => Deferred.make<void>()),
        Effect.let("GatedLive", ({ releasing, gate }) => Layer.scopedDiscard(Effect.addFinalizer(() => Deferred.succeed(releasing, undefined).pipe(Effect.andThen(Deferred.await(gate)))))),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("runtime", ({ scope, GatedLive }) => Scope.extend(Runtime.make(GatedLive), scope)),
        Effect.bind("closing", ({ scope }) => Effect.fork(Scope.close(scope, Exit.void))),
        Effect.tap(({ releasing }) => Deferred.await(releasing)),
        Effect.bind("exit", ({ runtime }) => Fiber.await(Runtime.runFork(runtime, Effect.sync(() => { ran = true; })))),
        Effect.tap(({ gate }) => Deferred.succeed(gate, undefined)),
        Effect.tap(({ closing }) => Fiber.join(closing)),
        Effect.map(({ exit }) => isRefusal(exit))
      ));

      expect(refused).toBe(true);
      expect(ran).toBe(false);
    });

    it("closes the bus before releasing any resource: no delivery follows a release", async () => {
      const log: Array<string> = [];

      const result = await Effect.runPromise(Effect.Do.pipe(
        // Release takes time, leaving a window in which a still-open bus would deliver.
        Effect.let("LoggedLive", () => Layer.scopedDiscard(Effect.addFinalizer(() => Effect.sync(() => { log.push("released"); }).pipe(Effect.andThen(Effect.sleep("5 millis")))))),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("runtime", ({ scope, LoggedLive }) => Scope.extend(Runtime.make(LoggedLive), scope)),
        Effect.let("consumer", ({ runtime }) => Runtime.runFork(runtime, Stream.runForEach(Event.subscribe(Ping), ({ n }) => Effect.sync(() => { log.push(`delivered ${n}`); })))),
        Effect.tap(() => Effect.sleep("1 millis")),
        // Admitted before termination, so it keeps publishing through it.
        Effect.let("publisher", ({ runtime }) => Runtime.runFork(runtime, Effect.iterate(0, {
          while: () => true,
          body: (n) => Event.publish(Ping, { n }).pipe(Effect.andThen(Effect.yieldNow()), Effect.as(n + 1)),
        }))),
        Effect.tap(() => eventually(Effect.sync(() => log.length), (length) => length >= 3)),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.bind("consumerExit", ({ consumer }) => Fiber.await(consumer).pipe(Effect.timeout(Duration.seconds(1)))),
        Effect.tap(() => Effect.sleep("10 millis")),
        Effect.bind("publisherExit", ({ publisher }) => Fiber.interrupt(publisher))
      ));

      const released = log.indexOf("released");

      expect(released).toBeGreaterThan(0);
      expect(log.slice(released + 1).filter((entry) => entry.startsWith("delivered"))).toEqual([]);
      expect(Exit.isSuccess(result.consumerExit)).toBe(true);
      // The publisher never failed: it ran until we interrupted it.
      expect(Exit.isInterrupted(result.publisherExit)).toBe(true);
    });

    it("terminates once, however often termination is requested", async () => {
      const releases = await Effect.runPromise(Effect.Do.pipe(
        Effect.bind("count", () => Ref.make(0)),
        Effect.let("CountedLive", ({ count }) => Layer.scopedDiscard(Effect.addFinalizer(() => Ref.update(count, (n) => n + 1)))),
        Effect.bind("scope", () => Scope.make()),
        Effect.bind("runtime", ({ scope, CountedLive }) => Scope.extend(Runtime.make(CountedLive), scope)),
        Effect.tap(({ runtime }) => Effect.all([terminate(runtime), terminate(runtime), terminate(runtime)], { concurrency: "unbounded" })),
        Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.flatMap(({ count }) => Ref.get(count))
      ));

      expect(releases).toBe(1);
    });
  });
});
