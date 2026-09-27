import { Cause, Context, Effect, Exit, Layer, Option, Scope } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as Application from "../src/application/index.js";
import * as Capability from "../src/capability/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Service from "../src/service/index.js";

interface FlashlightShape { readonly on: () => string }

const Flashlight = Capability.define<FlashlightShape>("device.flashlight");

const litResolutions = (): ReadonlyMap<string, Capability.CapabilityResolution<unknown>> => new Map<string, Capability.CapabilityResolution<unknown>>([
  [Flashlight.id, { _tag: "Available", implementation: { on: () => "lit" } }],
]);

interface ReporterShape { readonly report: () => Effect.Effect<string> }

const Reporter = Service.define<ReporterShape>("Reporter");

// A user layer that requires the environment (ApplicationAmbient, C14).
const ReporterLive: Layer.Layer<ReporterShape, never, Capability.EnvironmentShape> = Layer.effect(
  Reporter,
  Effect.map(Capability.resolve(Flashlight), (resolution) => ({
    report: () => Effect.succeed(resolution._tag === "Available" ? resolution.implementation.on() : "dark"),
  }))
);

// Runs `body` against a started application, then shuts it down.
const withApp = <R, A>(start: Effect.Effect<Application.RunningApplication<R>, Application.ApplicationInitError, Scope.Scope>, body: (running: Application.RunningApplication<R>) => Promise<A>): Promise<A> =>
  Effect.runPromise(Effect.scoped(start.pipe(
    Effect.andThen((running) => Effect.promise(() => body(running)).pipe(Effect.tap(() => Application.shutdown(running))))
  )));

describe("Platform: the supply point (v0.6 D30, D42)", () => {
  it("1. a platform's capability resolves through resolve, require and a user layer", async () => {
    const app = Application.define({ name: "lit", runtime: ReporterLive });

    const result = await withApp(Application.start(app, { platform: Capability.EnvironmentLive(litResolutions()) }), (running) => Promise.all([
      Runtime.run(running.runtime, Effect.map(Capability.resolve(Flashlight), (r) => r._tag)),
      Runtime.run(running.runtime, Effect.map(Capability.require(Flashlight), (flashlight) => flashlight.on())),
      Runtime.run(running.runtime, Effect.flatMap(Reporter, (reporter) => reporter.report())),
    ]));

    expect(result).toEqual(["Available", "lit", "lit"]);
  });

  it("2. no platform is the empty environment: every capability is Unavailable, as in v0.5", async () => {
    const app = Application.define({ name: "dark", runtime: ReporterLive });
    const expected = { _tag: "Unavailable", reason: "no resolution registered for 'device.flashlight'" };

    for (const start of [Application.start(app), Application.start(app, {})]) {
      const result = await withApp(start, (running) => Promise.all([
        Runtime.run(running.runtime, Capability.resolve(Flashlight)),
        Runtime.run(running.runtime, Effect.flatMap(Reporter, (reporter) => reporter.report())),
        Promise.resolve(running.environment.resolutions.size),
      ]));

      expect(result).toEqual([expected, "dark", 0]);
    }
  });

  it("8. RunningApplication.environment is exactly the map the platform built", async () => {
    const resolutions = litResolutions();
    const platform = Capability.EnvironmentLive(resolutions);

    const environment = await withApp(Application.start(Application.define({ name: "env", runtime: Layer.empty }), { platform }), async (running) => running.environment);

    expect(environment.resolutions).toBe(resolutions);
    expect([...environment.resolutions.keys()]).toEqual([Flashlight.id]);
  });

  it("a platform may not have requirements (type, C16)", () => {
    const needs = Layer.effect(Capability.Environment, Effect.map(Context.GenericTag<{ readonly x: 1 }>("X"), (): Capability.EnvironmentShape => ({ resolutions: new Map() })));
    // @ts-expect-error: Application.Platform requires nothing (C16, T1)
    const platform: Application.Platform = needs;

    void platform;
  });

  it("the application definition carries no environment (type, D31)", () => {
    // @ts-expect-error: the environment is supplied only by the platform (I29)
    Application.define({ name: "x", runtime: Layer.empty, environment: new Map() });
  });

  it("StartOptions is exactly { platform? } (type, D42)", () => {
    expectTypeOf<Application.StartOptions>().toEqualTypeOf<{ readonly platform?: Application.Platform }>();
  });
});

// A scoped platform that logs its acquisition and release (C15).
const logged = (log: Array<string>, implementation: unknown = {}, id = "probe.cap"): Application.Platform => Layer.scoped(Capability.Environment, Effect.acquireRelease(
  Effect.sync((): Capability.EnvironmentShape => {
    log.push("platform acquire");

    return { resolutions: new Map<string, Capability.CapabilityResolution<unknown>>([[id, { _tag: "Available", implementation }]]) };
  }),
  () => Effect.sync(() => { log.push("platform release"); })
));

// An application-layer resource that logs; its release may throw (dies) after logging.
const appResource = (log: Array<string>, releaseDies = false) => Layer.scopedDiscard(Effect.acquireRelease(
  Effect.sync(() => { log.push("app acquire"); }),
  () => Effect.sync(() => { log.push("app release"); }).pipe(Effect.andThen(releaseDies ? Effect.die("release boom") : Effect.void))
));

const failureOf = <A, E>(exit: Exit.Exit<A, E>): unknown => Exit.isFailure(exit) ? Option.getOrNull(Cause.failureOption(exit.cause)) : null;

const order = ["platform acquire", "app acquire", "running", "app release", "platform release"];

// The C15 lifetime invariant. The platform Layer is provided to the
// application-owned runtime scope, so the application's lifetime governs
// acquisition and release of platform resources: platform first in, last out,
// on both shutdown routes and on every start-failure path (I31).
describe("Platform: the lifetime invariant (v0.6 C15, I31)", () => {
  it("3. route 1 (Application.shutdown): platform acquire, app acquire, running, app release, platform release", async () => {
    const log: Array<string> = [];
    const app = Application.define({ name: "route-1", runtime: appResource(log) });

    const status = await Effect.runPromise(Effect.scoped(Application.start(app, { platform: logged(log) }).pipe(
      Effect.tap(() => Effect.sync(() => { log.push("running"); })),
      Effect.tap((running) => Application.shutdown(running)),
      Effect.andThen((running) => Application.status(running))
    )));

    expect(log).toEqual(order);
    expect(status).toEqual({ _tag: "Stopped" });
  });

  it("3. route 2 (closing the start scope): the same order", async () => {
    const log: Array<string> = [];
    const app = Application.define({ name: "route-2", runtime: appResource(log) });

    const status = await Effect.runPromise(Effect.Do.pipe(
      Effect.bind("scope", () => Scope.make()),
      Effect.bind("running", ({ scope }) => Scope.extend(Application.start(app, { platform: logged(log) }), scope)),
      Effect.tap(() => Effect.sync(() => { log.push("running"); })),
      Effect.tap(({ scope }) => Scope.close(scope, Exit.void)),
      Effect.andThen(({ running }) => Application.status(running))
    ));

    expect(log).toEqual(order);
    expect(status).toEqual({ _tag: "Stopped" });
  });

  it("4. platform acquisition failure: ServiceGraphFailed, no handle, its acquisition released, the application layer never built", async () => {
    const log: Array<string> = [];
    const app = Application.define({ name: "platform-fails", runtime: appResource(log) });
    const platform: Application.Platform = Layer.merge(logged(log), Layer.fail("platform boom"));

    const observed = await Effect.runPromise(Effect.scoped(Effect.exit(Application.start(app, { platform }).pipe(
      Effect.tap(() => Effect.sync(() => { log.push("running"); }))
    )).pipe(
      // Observed inside the caller's scope: nothing may wait for that scope to close.
      Effect.map((exit) => ({ exit, log: [...log] }))
    )));

    expect(Exit.isFailure(observed.exit)).toBe(true);
    expect(failureOf(observed.exit)).toMatchObject({ _tag: "ServiceGraphFailed" });
    expect(observed.log).toEqual(["platform acquire", "platform release"]);
    expect(log).toEqual(["platform acquire", "platform release"]);
  });

  it("4a. application-layer failure after platform acquisition: app release then platform release, before start fails; no handle", async () => {
    const log: Array<string> = [];
    const app = Application.define({ name: "app-fails", runtime: Layer.merge(appResource(log), Layer.fail("app boom")) });

    const observed = await Effect.runPromise(Effect.scoped(Effect.exit(Application.start(app, { platform: logged(log) }).pipe(
      Effect.tap(() => Effect.sync(() => { log.push("running"); }))
    )).pipe(
      Effect.map((exit) => ({ exit, log: [...log] }))
    )));

    expect(Exit.isFailure(observed.exit)).toBe(true);
    expect(failureOf(observed.exit)).toMatchObject({ _tag: "ServiceGraphFailed" });
    expect(observed.log).toEqual(["platform acquire", "app acquire", "app release", "platform release"]);
    expect(log).toEqual(observed.log);
  });

  it("4b. a release that throws during shutdown: platform release still follows, status Stopped, the performer re-raises", async () => {
    const log: Array<string> = [];
    const app = Application.define({ name: "release-dies", runtime: appResource(log, true) });

    const observed = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind("running", () => Application.start(app, { platform: logged(log) })),
      Effect.tap(() => Effect.sync(() => { log.push("running"); })),
      Effect.bind("shutdown", ({ running }) => Effect.exit(Application.shutdown(running))),
      Effect.bind("status", ({ running }) => Application.status(running))
    )));

    expect(Exit.isFailure(observed.shutdown) && Cause.isDie(observed.shutdown.cause)).toBe(true);
    expect(observed.status).toEqual({ _tag: "Stopped" });
    expect(log).toEqual(order);
  });
});

describe("Platform: isolation (v0.6 C15, D30)", () => {
  it("5. one platform value started twice concurrently: independent acquisitions and resolutions", async () => {
    const log: Array<string> = [];
    const platform = logged(log, { n: 1 });
    const app = Application.define({ name: "twice", runtime: Layer.empty });
    const Probe = Capability.define<{ readonly n: number }>("probe.cap");

    const survivor = await Effect.runPromise(Effect.scoped(Effect.all([Application.start(app, { platform }), Application.start(app, { platform })], { concurrency: "unbounded" }).pipe(
      Effect.tap(([first]) => Application.shutdown(first)),
      Effect.andThen(([, second]) => Effect.promise(() => Runtime.run(second.runtime, Capability.resolve(Probe))))
    )));

    expect(log.filter((entry) => entry === "platform acquire")).toHaveLength(2);
    expect(survivor).toMatchObject({ _tag: "Available", implementation: { n: 1 } });
  });

  it("6. two concurrent applications on different platforms resolve their own implementations", async () => {
    const app = Application.define({ name: "two-platforms", runtime: Layer.empty });
    const Probe = Capability.define<{ readonly n: number }>("probe.cap");
    const resolveOn = (n: number) => Application.start(app, { platform: logged([], { n }) }).pipe(
      Effect.andThen((running) => Effect.promise(() => Runtime.run(running.runtime, Effect.map(Capability.require(Probe), (probe) => probe.n))))
    );

    const result = await Effect.runPromise(Effect.scoped(Effect.all([resolveOn(1), resolveOn(2)], { concurrency: "unbounded" })));

    expect(result).toEqual([1, 2]);
  });
});

describe("Platform: NEXUS names no execution environment (v0.6 D33, I30)", () => {
  it("an Available resolution has no source (type)", () => {
    // @ts-expect-error: CapabilityResolution carries no source (D33)
    const resolution: Capability.CapabilityResolution<{}> = { _tag: "Available", implementation: {}, source: "native" };

    void resolution;
  });

  it("resolving through a platform yields exactly _tag and implementation", async () => {
    const result = await Effect.runPromise(Capability.resolve(Flashlight).pipe(Effect.provide(Capability.EnvironmentLive(litResolutions()))));

    expect(Object.keys(result).sort()).toEqual(["_tag", "implementation"]);
  });
});
