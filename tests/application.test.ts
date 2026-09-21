import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import * as Application from "../src/application/index.js";
import * as Service from "../src/service/index.js";

interface ClockShape { readonly now: () => number }
const Clock = Service.define<ClockShape>("Clock");
const ClockLive = Service.layerSync(Clock, () => ({ now: () => 7 }));

describe("Application", () => {
  it("reaches Running after a successful start", async () => {
    const finalStatus = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const app = Application.define({ name: "test-app", runtime: ClockLive });
          const running = yield* Application.start(app);
          return yield* Application.status(running);
        })
      )
    );
    expect(finalStatus).toEqual({ _tag: "Running" });
  });

  it("fails to start with a typed ServiceGraphFailed error when the service graph can't build", async () => {
    interface BrokenShape { readonly value: number }
    const Broken = Service.define<BrokenShape>("Broken");
    const BrokenLive = Layer.effect(Broken, Effect.fail("boom" as const)) as unknown as Layer.Layer<
      BrokenShape,
      unknown,
      never
    >;

    const exit = await Effect.runPromiseExit(
      Effect.scoped(Application.start(Application.define({ name: "broken-app", runtime: BrokenLive })))
    );
    expect(exit._tag).toBe("Failure");
  });

  it("transitions to Stopped and releases resources on shutdown", async () => {
    let released = false;
    interface HeldShape { readonly ok: boolean }
    const Held = Service.define<HeldShape>("Held");
    const HeldLive = Layer.scoped(
      Held,
      Effect.acquireRelease(Effect.succeed({ ok: true }), () => Effect.sync(() => { released = true; }))
    );

    const finalStatus = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const running = yield* Application.start(Application.define({ name: "held-app", runtime: HeldLive }));
          yield* Application.shutdown(running);
          return yield* Application.status(running);
        })
      )
    );
    expect(finalStatus).toEqual({ _tag: "Stopped" });
    expect(released).toBe(true);
  });
});
