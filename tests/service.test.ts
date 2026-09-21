import { describe, it, expect } from "vitest";
import { Effect, Exit, Layer } from "effect";

import * as Service from "../src/service/index.js";

describe("Service", () => {
  it("resolves a typed dependency provided via a layer", async () => {
    interface ClockShape { readonly now: () => number }
    const Clock = Service.define<ClockShape>("Clock");
    const ClockLive = Service.layerSync(Clock, () => ({ now: () => 42 }));

    const program = Effect.Do.pipe(
      Effect.andThen(Clock),
      Effect.map((clock) => clock.now())
    );

    const result = await Effect.runPromise(Effect.provide(program, ClockLive));
    expect(result).toBe(42);
  });

  it("composes multiple layers into one service graph", async () => {
    interface AShape { readonly a: number }
    interface BShape { readonly b: number }
    const A = Service.define<AShape>("A");
    const B = Service.define<BShape>("B");
    const ALive = Service.layerSync(A, () => ({ a: 1 }));
    const BLive = Service.layerSync(B, () => ({ b: 2 }));

    const program = Effect.Do.pipe(
      Effect.bind("a", () => A),
      Effect.bind("b", () => B),
      Effect.map(({ a, b }) => a.a + b.b)
    );

    const result = await Effect.runPromise(Effect.provide(program, Layer.merge(ALive, BLive)));
    expect(result).toBe(3);
  });

  it("fails to run when a dependency's layer was never provided", async () => {
    interface CShape { readonly c: number }
    const C = Service.define<CShape>("C");
    const program = Effect.Do.pipe(
      Effect.andThen(C),
      Effect.map((c) => c.c)
    ) as Effect.Effect<number>;

    const exit = await Effect.runPromiseExit(program);

    expect(exit).is.satisfies(Exit.isFailure);
  });

  it("supports effectful implementations via Service.layer", async () => {
    interface ConfigShape { readonly port: number }
    const Config = Service.define<ConfigShape>("Config");
    const ConfigLive = Service.layer(Config, Effect.succeed({ port: 8080 }));

    const result = await Effect.runPromise(Effect.provide(Config, ConfigLive));

    expect(result).toEqual({ port: 8080 });
  });
});
