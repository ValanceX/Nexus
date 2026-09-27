import type { Scope } from "effect";

import { Context, Effect, Layer } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as Application from "../src/application/index.js";
import * as Capability from "../src/capability/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Service from "../src/service/index.js";

interface FlashlightShape { readonly on: () => string }

const Flashlight = Capability.define<FlashlightShape>("device.flashlight");

const litResolutions = (): ReadonlyMap<string, Capability.CapabilityResolution<unknown>> => new Map<string, Capability.CapabilityResolution<unknown>>([
  // v0.6 Task 8 removes source
  [Flashlight.id, { _tag: "Available", implementation: { on: () => "lit" }, source: "native" }],
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

  it("StartOptions is exactly { platform? } (type, D42)", () => {
    expectTypeOf<Application.StartOptions>().toEqualTypeOf<{ readonly platform?: Application.Platform }>();
  });
});
