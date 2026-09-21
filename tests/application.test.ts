import { describe, it, expect } from "vitest";
import { Cause, Effect, Layer, Option } from "effect";
import * as Application from "../src/application/index.js";
import * as Capability from "../src/capability/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Service from "../src/service/index.js";

interface ClockShape { readonly now: () => number }
const Clock = Service.define<ClockShape>("Clock");
const ClockLive = Service.layerSync(Clock, () => ({ now: () => 7 }));

describe("Application", () => {
  it("reaches Running after a successful start", async () => {
    const finalStatus = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Application.start(Application.define({ name: "test-app", runtime: ClockLive }))),
      Effect.andThen(Application.status)
    )));

    expect(finalStatus).toEqual({ _tag: "Running" });
  });

  it("fails to start with a typed ServiceGraphFailed error when the service graph can't build", async () => {
    interface BrokenShape { readonly value: number }

    const Broken = Service.define<BrokenShape>("Broken");
    const BrokenLive = Layer.effect(Broken, Effect.fail("boom" as const)) as unknown as Layer.Layer<BrokenShape, unknown, never>;

    // Effect.flip surfaces the typed error value itself: if `start` ever died
    // with a raw exception instead of failing with an ApplicationInitError,
    // the flipped effect would reject rather than produce this value.
    const error = await Effect.runPromise(Effect.scoped(Effect.flip(Application.start(Application.define({ name: "broken-app", runtime: BrokenLive })))));

    expect(error._tag).toBe("ServiceGraphFailed");
    expect(error).toHaveProperty("cause");

    const cause = (error as Extract<Application.ApplicationInitError, { _tag: "ServiceGraphFailed" }>).cause;

    expect(Cause.isCause(cause)).toBe(true);
    // The wrapped Cause carries Runtime's own typed LayerBuildFailed, whose
    // cause is the layer's "boom" failure — no defect anywhere in the chain.
    expect(Option.getOrNull(Cause.failureOption(cause as Cause.Cause<unknown>))).toEqual({
      _tag: "LayerBuildFailed",
      cause: "boom",
    });
  });

  it("resolves Environment before the service graph, so a user layer may require it", async () => {
    interface FlashlightShape {
      readonly on: () => string
    }

    const Flashlight = Capability.define<FlashlightShape>("device.flashlight");

    interface ReporterShape { readonly report: () => Effect.Effect<string> }
    const Reporter = Service.define<ReporterShape>("Reporter");
    // The user's own layer declares Capability.EnvironmentShape as a requirement.
    // This only compiles because start provide-merges EnvironmentLive into it.
    const ReporterLive: Layer.Layer<ReporterShape, never, Capability.EnvironmentShape> = Layer.effect(
      Reporter,
      Effect.map(Capability.resolve(Flashlight), (resolution) => ({
        report: () => Effect.succeed(resolution._tag === "Available" ? resolution.implementation.on() : "dark"),
      }))
    );

    const environment = new Map<string, Capability.CapabilityResolution<unknown>>([
      ["device.flashlight", { _tag: "Available", implementation: { on: () => "lit" }, source: "native" }],
    ]);

    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Application.start(Application.define({ name: "ambient-app", runtime: ReporterLive, environment }))),
      Effect.andThen((running) => Effect.Do.pipe(
        Effect.andThen(Effect.all({
          direct: Effect.promise(() => Runtime.run(running.runtime, Effect.map(Capability.resolve(Flashlight), (r) => r._tag))),
          fromService: Effect.promise(() => Runtime.run(running.runtime, Effect.flatMap(Reporter, (r) => r.report())))
        }, { concurrency: 'unbounded' })),
        Effect.andThen(returnValue => Effect.Do.pipe(
          Effect.andThen(Application.shutdown(running)),
          Effect.map(() => returnValue)
        ))
      )),
    )));

    expect(result.fromService).toBe("lit");
    expect(result.direct).toBe("Available");
  });

  it("transitions to Stopped and releases resources on shutdown", async () => {
    let released = false;

    interface HeldShape { readonly ok: boolean }

    const Held = Service.define<HeldShape>("Held");
    const HeldLive = Layer.scoped(
      Held,
      Effect.acquireRelease(Effect.succeed({ ok: true }), () => Effect.sync(() => { released = true; }))
    );

    const finalStatus = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Application.start(Application.define({ name: "held-app", runtime: HeldLive }))),
      Effect.andThen(running => Effect.Do.pipe(
        Effect.andThen(Application.shutdown(running)),
        Effect.andThen(Application.status(running))
      ))
    )));

    expect(finalStatus).toEqual({ _tag: "Stopped" });
    expect(released).toBe(true);
  });
});
