import { describe, it, expect } from "vitest";
import { Effect } from "effect";

import * as Capability from "../src/capability/index.js";

interface HapticsShape { readonly vibrate: () => number }

describe("Capability", () => {
  const Haptics = Capability.define<HapticsShape>("haptics");

  it("resolves to Available when the environment provides an implementation", async () => {
    const resolutions = new Map<string, Capability.CapabilityResolution<unknown>>([
      [Haptics.id, { _tag: "Available", implementation: { vibrate: () => 1 } }],
    ]);
    const result = await Effect.runPromise(
      Capability.resolve(Haptics).pipe(Effect.provide(Capability.EnvironmentLive(resolutions)))
    );
    expect(result._tag).toBe("Available");
    expect(Object.keys(result).sort()).toEqual(["_tag", "implementation"]);
  });

  it("resolves to Unavailable when nothing is registered", async () => {
    const result = await Effect.runPromise(
      Capability.resolve(Haptics).pipe(Effect.provide(Capability.EnvironmentLive(new Map())))
    );
    expect(result._tag).toBe("Unavailable");
  });

  it("a platform-supplied substitute implementation is just Available", async () => {
    const resolutions = new Map<string, Capability.CapabilityResolution<unknown>>([
      [Haptics.id, { _tag: "Available", implementation: { vibrate: () => 0 } }],
    ]);
    const result = await Effect.runPromise(
      Capability.resolve(Haptics).pipe(Effect.provide(Capability.EnvironmentLive(resolutions)))
    );
    expect(result).toMatchObject({ _tag: "Available" });
    expect(result._tag === "Available" && result.implementation.vibrate()).toBe(0);
  });

  it("require fails with a typed CapabilityUnavailableError when unavailable", async () => {
    const error = await Effect.runPromise(
      Effect.flip(Capability.require(Haptics).pipe(Effect.provide(Capability.EnvironmentLive(new Map()))))
    );
    expect(error).toEqual({
      _tag: "CapabilityUnavailableError",
      id: "haptics",
      reason: "no resolution registered for 'haptics'",
    });
  });

  it("require succeeds with the implementation when available", async () => {
    const resolutions = new Map<string, Capability.CapabilityResolution<unknown>>([
      [Haptics.id, { _tag: "Available", implementation: { vibrate: () => 5 } }],
    ]);
    const result = await Effect.runPromise(
      Capability.require(Haptics).pipe(Effect.provide(Capability.EnvironmentLive(resolutions)))
    );
    expect((result as HapticsShape).vibrate()).toBe(5);
  });
});
