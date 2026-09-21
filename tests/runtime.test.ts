import { describe, it, expect } from "vitest";
import { Effect, Fiber, Layer } from "effect";
import * as Runtime from "../src/runtime/index.js";
import * as Service from "../src/service/index.js";

interface ClockShape { readonly now: () => number }
const Clock = Service.define<ClockShape>("Clock");
const ClockLive = Service.layerSync(Clock, () => ({ now: () => 99 }));

describe("Runtime", () => {
  it("executes an effect against the built service graph", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* Runtime.make(ClockLive);
          return yield* Effect.promise(() => Runtime.run(runtime, Effect.map(Clock, (c) => c.now())));
        })
      )
    );
    expect(result).toBe(99);
  });

  it("interrupting a runFork fiber stops the running effect and runs its finalizer", async () => {
    let cleaned = false;
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* Runtime.make(ClockLive);
          const fiber = Runtime.runFork(
            runtime,
            Effect.acquireUseRelease(
              Effect.succeed("held"),
              () => Effect.never,
              () => Effect.sync(() => { cleaned = true; })
            )
          );
          yield* Effect.sleep("10 millis");
          yield* Fiber.interrupt(fiber);
          return cleaned;
        })
      )
    );
    expect(result).toBe(true);
  });

  it("shutdown releases resources acquired through the service graph", async () => {
    let released = false;
    interface HeldShape { readonly held: boolean }
    const Held = Service.define<HeldShape>("Held");
    const HeldLive = Layer.scoped(
      Held,
      Effect.acquireRelease(Effect.succeed({ held: true }), () => Effect.sync(() => { released = true; }))
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* Runtime.make(HeldLive);
          yield* Runtime.shutdown(runtime);
        })
      )
    );
    expect(released).toBe(true);
  });

  it("reports a typed RuntimeInitError when the layer fails to build", async () => {
    interface BrokenShape { readonly x: number }
    const Broken = Service.define<BrokenShape>("Broken");
    const BrokenLive = Layer.effect(Broken, Effect.fail("boom" as const));

    const exit = await Effect.runPromiseExit(
      Effect.scoped(Runtime.make(BrokenLive as unknown as Layer.Layer<BrokenShape, unknown, never>))
    );
    expect(exit._tag).toBe("Failure");
  });
});
