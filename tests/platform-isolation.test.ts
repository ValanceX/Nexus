// v0.9 platform isolation (outline docs/superpowers/specs/2026-09-28-nexus-v0.9-outline.md,
// I44–I49, C29–C31). The regressions derive from the P1 finding of the integration audit
// (docs/architecture/2026-09-28-valance-integration-audit.md §16) and the outline's E1–E3.
//
// The boundary: FiberRefs flow caller → application (inherited, with the precedence
// caller < platform < application layer inside the application), never application or
// platform → caller. "The caller" is the fiber that starts the application and the
// fiber that terminates it.
//
// Every observation compares identities (is this the platform's value?), never wall
// clock readings.
import { Clock, Config, ConfigProvider, Context, Deferred, Effect, Exit, Fiber, FiberRef, Layer, LogLevel, Random, Scope } from "effect";
import * as DefaultServices from "effect/DefaultServices";
import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

import { referencePlatform } from "./platform/reference.js";

// ---------------------------------------------------------------------------
// FiberRef kinds (M1). Each sets a value through an Effect Layer, and reads
// whether the current fiber sees that value. Clock is not special: three default
// services share the `currentServices` FiberRef, and the minimum log level is a
// FiberRef of its own.

const fixed = (n: number): Clock.Clock => ({ ...Clock.make(), currentTimeMillis: Effect.succeed(n), unsafeCurrentTimeMillis: () => n });
const is42 = Effect.map(Clock.currentTimeMillis, (t) => t === 42);

interface Kind {
  readonly name: string;
  readonly set: Layer.Layer<never>;
  /** Whether the reading fiber sees the value `set` installs. */
  readonly sees: Effect.Effect<boolean>;
}

const kinds: ReadonlyArray<Kind> = [
  { name: "Clock (Layer.setClock)", set: Layer.setClock(fixed(42)), sees: is42 },
  {
    name: "Random (Layer.setRandom)",
    set: Layer.setRandom({ ...Random.make("platform"), nextInt: Effect.succeed(777777) } as Random.Random),
    sees: Effect.map(Effect.randomWith((random) => random.nextInt), (n) => n === 777777),
  },
  {
    name: "ConfigProvider (Layer.setConfigProvider)",
    set: Layer.setConfigProvider(ConfigProvider.fromMap(new Map([["NEXUS_ISOLATION_PROBE", "platform"]]))),
    sees: Effect.map(Effect.orElseSucceed(Config.string("NEXUS_ISOLATION_PROBE"), () => "unset"), (value) => value === "platform"),
  },
  {
    name: "minimum log level (Layer.locallyScoped)",
    set: Layer.locallyScoped(FiberRef.currentMinimumLogLevel, LogLevel.Error),
    sees: Effect.map(FiberRef.get(FiberRef.currentMinimumLogLevel), (level) => level._tag === "Error"),
  },
];

const compositions = {
  merge: (a: Layer.Layer<Nexus.Capability.EnvironmentShape>, b: Layer.Layer<never>) => Layer.merge(a, b),
  provideMerge: (a: Layer.Layer<Nexus.Capability.EnvironmentShape>, b: Layer.Layer<never>) => Layer.provideMerge(a, b),
} as const;

type Composition = keyof typeof compositions;
type Placement = "platform" | "application layer";
type Route = "Application.shutdown" | "closing the start scope";

const empty = (): Layer.Layer<Nexus.Capability.EnvironmentShape> => Nexus.Capability.EnvironmentLive(new Map());
const define = (runtime: Layer.Layer<never, unknown, Nexus.Application.ApplicationAmbient> = Layer.empty) => Nexus.Application.define({ name: "isolation", runtime });

const inApp = <A>(running: Nexus.Application.RunningApplication<never>, effect: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.promise(() => Nexus.Runtime.run(running.runtime, effect));

const stop = (route: Route, running: Nexus.Application.RunningApplication<never>, scope: Scope.CloseableScope): Effect.Effect<void> =>
  route === "Application.shutdown" ? Nexus.Application.shutdown(running) : Scope.close(scope, Exit.void);

// A layer composed the way a platform (or an application layer) author would.
const composed = (composition: Composition, placement: Placement, kind: Kind) => ({
  platform: placement === "platform" ? compositions[composition](empty(), kind.set) : empty(),
  runtime: placement === "application layer" ? compositions[composition](empty(), kind.set) : Layer.empty,
});

// ---------------------------------------------------------------------------
// The matrix (M1 × M2 × M3 × M4, observed as M5).

describe("Platform isolation: the matrix (I44, I46, I47)", () => {
  const cases = kinds.flatMap((kind) => (["merge", "provideMerge"] as const).flatMap((composition) =>
    (["platform", "application layer"] as const).flatMap((placement) =>
      (["Application.shutdown", "closing the start scope"] as const).map((route) => ({ kind, composition, placement, route })))));

  it.each(cases)("$kind.name, $composition, in the $placement, stopped by $route: only the application sees it", async ({ kind, composition, placement, route }) => {
    const { platform, runtime } = composed(composition, placement, kind);

    const observed = await Effect.runPromise(Effect.gen(function* () {
      const before = yield* kind.sees;
      const scope = yield* Scope.make();
      const running = yield* Nexus.Application.start(define(runtime), { platform }).pipe(Scope.extend(scope));
      const inside = yield* inApp(running, kind.sees);
      const during = yield* kind.sees;
      yield* stop(route, running, scope);
      const after = yield* kind.sees;
      // Sequential: an application started afterwards, from the same fiber, with no platform.
      const later = yield* Effect.scoped(Effect.flatMap(Nexus.Application.start(define()), (next) => inApp(next, kind.sees)));

      return { before, inside, during, after, later };
    }));

    expect(observed).toEqual({ before: false, inside: true, during: false, after: false, later: false });
  });
});

// ---------------------------------------------------------------------------
// A FiberRef written by a release that isn't protected by Effect.addFinalizer's
// patching: a finalizer added to the scope directly. It runs in whichever fiber
// closes the application's scope (outline E3: build-only isolation leaks it).

describe("Platform isolation: termination (I46, C30)", () => {
  const rawFinalizerPlatform = (): Nexus.Application.Platform => Layer.merge(
    empty(),
    Layer.scopedDiscard(Effect.flatMap(Effect.scope, (scope) => Scope.addFinalizer(scope, FiberRef.set(FiberRef.currentMinimumLogLevel, LogLevel.Error))))
  );

  it.each(["Application.shutdown", "closing the start scope"] as const)("a raw scope finalizer writes nothing into the fiber that stops the application (%s)", async (route) => {
    const level = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* Nexus.Application.start(define(), { platform: rawFinalizerPlatform() }).pipe(Scope.extend(scope));
      yield* stop(route, running, scope);

      return (yield* FiberRef.get(FiberRef.currentMinimumLogLevel))._tag;
    }));

    expect(level).toBe("Info");
  });
});

// ---------------------------------------------------------------------------
// Precedence inside the application is unchanged (I45, D39), and nothing reaches
// the caller or another application that is still running.

describe("Platform isolation: precedence and other applications (I45, I47)", () => {
  it("platform over caller, application layer over platform, the caller reaches a new application, and the caller is unchanged", async () => {
    const observed = await Effect.runPromise(Effect.withClock(Effect.scoped(Effect.gen(function* () {
      const platformOnly = yield* Nexus.Application.start(define(), { platform: Layer.merge(empty(), Layer.setClock(fixed(2))) });
      const layered = yield* Nexus.Application.start(define(Layer.setClock(fixed(3))), { platform: Layer.merge(empty(), Layer.setClock(fixed(2))) });
      // Sequential, with both earlier applications still running.
      const plain = yield* Nexus.Application.start(define());

      return {
        platformOverCaller: yield* inApp(platformOnly, Clock.currentTimeMillis),
        layerOverPlatform: yield* inApp(layered, Clock.currentTimeMillis),
        callerReachesNewApplication: yield* inApp(plain, Clock.currentTimeMillis),
        caller: yield* Clock.currentTimeMillis,
      };
    })), fixed(1)));

    expect(observed).toEqual({ platformOverCaller: 2, layerOverPlatform: 3, callerReachesNewApplication: 1, caller: 1 });
  });

  it("two applications started concurrently from one fiber each see their own platform, and the caller sees neither", async () => {
    const observed = await Effect.runPromise(Effect.gen(function* () {
      const during = yield* Effect.scoped(Effect.gen(function* () {
        const [a, b] = yield* Effect.all([
          Nexus.Application.start(define(), { platform: Layer.merge(empty(), Layer.setClock(fixed(10))) }),
          Nexus.Application.start(define(), { platform: Layer.merge(empty(), Layer.setClock(fixed(20))) }),
        ], { concurrency: 2 });

        return { a: yield* inApp(a, Clock.currentTimeMillis), b: yield* inApp(b, Clock.currentTimeMillis), caller: yield* Clock.currentTimeMillis };
      }));
      const after = yield* Clock.currentTimeMillis;

      return { a: during.a, b: during.b, callerDuring: [10, 20].includes(during.caller), callerAfter: [10, 20].includes(after) };
    }));

    expect(observed).toEqual({ a: 10, b: 20, callerDuring: false, callerAfter: false });
  });

  it("the reference platform's Clock doesn't reach a later application (audit X4)", async () => {
    const later = await Effect.runPromise(Effect.gen(function* () {
      yield* Effect.scoped(Effect.flatMap(Nexus.Application.start(define(), { platform: referencePlatform({ clock: fixed(42) }) }), Nexus.Application.shutdown));

      return yield* Effect.scoped(Effect.flatMap(Nexus.Application.start(define()), (next) => inApp(next, is42)));
    }));

    expect(later).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Start failure and interruption (I44, I46, I49, C31): the platform is still
// acquired and released as before, and the caller is unchanged.

describe("Platform isolation: failed and interrupted starts (I44, I46, I49, C31)", () => {
  const trackedPlatform = (composition: Composition, log: Array<string>): Nexus.Application.Platform => compositions[composition](
    empty(),
    Layer.merge(Layer.setClock(fixed(42)), Layer.scopedDiscard(Effect.acquireRelease(Effect.sync(() => { log.push("platform acquire"); }), () => Effect.sync(() => { log.push("platform release"); }))))
  );

  it.each(["merge", "provideMerge"] as const)("a failed start (%s): ServiceGraphFailed, the platform released, and the caller unchanged", async (composition) => {
    const log: Array<string> = [];

    const observed = await Effect.runPromise(Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.scoped(Nexus.Application.start(define(Layer.fail("boom")), { platform: trackedPlatform(composition, log) })));

      return { failed: Exit.isFailure(exit) && Exit.match(exit, { onFailure: (cause) => JSON.stringify(cause).includes("ServiceGraphFailed"), onSuccess: () => false }), caller: yield* is42 };
    }));

    expect(observed).toEqual({ failed: true, caller: false });
    expect(log).toEqual(["platform acquire", "platform release"]);
  });

  it.each(["merge", "provideMerge"] as const)("an interrupted start (%s): the platform released before the interruption completes, and the caller unchanged", async (composition) => {
    const log: Array<string> = [];

    const observed = await Effect.runPromise(Effect.gen(function* () {
      const building = yield* Deferred.make<void>();
      const blocked = Layer.scopedDiscard(Effect.zipRight(Deferred.succeed(building, undefined), Effect.never));
      const fiber = yield* Effect.fork(Effect.scoped(Nexus.Application.start(define(blocked), { platform: trackedPlatform(composition, log) })));
      yield* Deferred.await(building);
      const exit = yield* Fiber.interrupt(fiber);
      const releasedBeforeInterruptReturned = [...log];

      return { interrupted: Exit.isInterrupted(exit), releasedBeforeInterruptReturned, caller: yield* is42 };
    }));

    expect(observed).toEqual({ interrupted: true, releasedBeforeInterruptReturned: ["platform acquire", "platform release"], caller: false });
  });
});

// ---------------------------------------------------------------------------
// Finalizers (I48): a release sees exactly what its acquisition saw, and the
// release order is unchanged. A sibling of a merged Clock doesn't see it, at
// acquisition or release (Effect's merge semantics, outline O18).

describe("Platform isolation: finalizers (I48)", () => {
  it.each(["Application.shutdown", "closing the start scope"] as const)("each release sees what its acquisition saw, in the unchanged order (%s)", async (route) => {
    const log: Array<string> = [];
    const tracked = (name: string) => Layer.scopedDiscard(Effect.acquireRelease(
      Effect.flatMap(is42, (seen) => Effect.sync(() => { log.push(`${name} acquire ${seen}`); })),
      () => Effect.flatMap(is42, (seen) => Effect.sync(() => { log.push(`${name} release ${seen}`); }))
    ));
    // Clock first, then the ordered resource (provideMerge), next to a sibling of the Clock (merge).
    const platform = Layer.merge(empty(), Layer.merge(Layer.provideMerge(tracked("ordered platform"), Layer.setClock(fixed(42))), tracked("sibling platform")));

    await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* Nexus.Application.start(define(tracked("application")), { platform }).pipe(Scope.extend(scope));
      yield* stop(route, running, scope);
    }));

    const acquired = log.slice(0, 3).sort();
    const released = log.slice(3);

    expect(acquired).toEqual(["application acquire true", "ordered platform acquire true", "sibling platform acquire false"]);
    expect(released[0]).toBe("application release true");
    expect([...released.slice(1)].sort()).toEqual(["ordered platform release true", "sibling platform release false"]);
  });
});

// ---------------------------------------------------------------------------
// The caller's own changes are the caller's (I44).

describe("Platform isolation: the caller's own changes (I44)", () => {
  const setCallerClock = (n: number) => FiberRef.update(DefaultServices.currentServices, (services) => Context.add(services, Clock.Clock, fixed(n)));

  const cases = (["merge", "provideMerge"] as const).flatMap((composition) =>
    (["Application.shutdown", "closing the start scope"] as const).map((route) => ({ composition, route })));

  it.each(cases)("a Clock the caller sets while the application runs is kept after it stops ($composition, $route)", async ({ composition, route }) => {
    const observed = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* Nexus.Application.start(define(), { platform: compositions[composition](empty(), Layer.setClock(fixed(42))) }).pipe(Scope.extend(scope));
      yield* setCallerClock(9);
      const inside = yield* inApp(running, Clock.currentTimeMillis);
      yield* stop(route, running, scope);

      return { inside, caller: yield* Clock.currentTimeMillis };
    }));

    expect(observed).toEqual({ inside: 42, caller: 9 });
  });
});

// ---------------------------------------------------------------------------
// Start stays synchronous where every layer is (I49), and a standalone runtime
// is isolated the same way (M12).

describe("Platform isolation: runSync and a standalone runtime (I49, M12)", () => {
  it("Application.start and shutdown run under Effect.runSync", () => {
    const status = Effect.runSync(Effect.scoped(Effect.gen(function* () {
      const running = yield* Nexus.Application.start(define(), { platform: Layer.merge(empty(), Layer.setClock(fixed(42))) });
      yield* Nexus.Application.shutdown(running);

      return yield* Nexus.Application.status(running);
    })));

    expect(status).toEqual({ _tag: "Stopped" });
  });

  it("Runtime.make runs under Effect.runSync", () => {
    expect(() => Effect.runSync(Effect.scoped(Nexus.Runtime.make(Layer.merge(Layer.empty, Layer.setClock(fixed(42))))))).not.toThrow();
  });

  it.each(["merge", "provideMerge"] as const)("a standalone Runtime.make with a FiberRef layer (%s): only its runtime sees it", async (composition) => {
    const clock = Layer.setClock(fixed(42));
    const layer = composition === "merge" ? Layer.merge(Layer.empty, clock) : Layer.provideMerge(Layer.empty, clock);

    const observed = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const runtime = yield* Nexus.Runtime.make(layer).pipe(Scope.extend(scope));
      const inside = yield* Effect.promise(() => Nexus.Runtime.run(runtime, is42));
      const during = yield* is42;
      yield* Scope.close(scope, Exit.void);

      return { inside, during, after: yield* is42 };
    }));

    expect(observed).toEqual({ inside: true, during: false, after: false });
  });
});
