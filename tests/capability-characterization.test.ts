import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import * as Application from "../src/application/index.js";
import * as Capability from "../src/capability/index.js";
import * as Runtime from "../src/runtime/index.js";

// v0.7 characterizations (outline tests 4 and 5). They pin *existing* behavior
// so that capability-model work can't change it by accident. They describe
// what happens; they don't endorse it as a composition or identity design.

const available = (implementation: unknown): Capability.CapabilityResolution<unknown> => ({ _tag: "Available", implementation });

// `Capability<Shape>` is invariant in Shape (v0.6 D37), so a list of mixed Shapes needs `any`.
const resolveAll = (platform: Application.Platform, capabilities: ReadonlyArray<Capability.Capability<any>>) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const running = yield* Application.start(Application.define({ name: "characterization", runtime: Layer.empty }), { platform });
    return yield* Effect.promise(() => Runtime.run(running.runtime, Effect.forEach(capabilities, (capability): Effect.Effect<Capability.CapabilityResolution<unknown>, never, Capability.EnvironmentShape> => Capability.resolve(capability))));
  })));

const summary = (resolution: Capability.CapabilityResolution<unknown>) => resolution._tag === "Available" ? resolution.implementation : "Unavailable";

describe("Characterization: Environment composition (v0.7 D50, R18)", () => {
  const Storage = Capability.define<string>("acme.storage");
  const Network = Capability.define<string>("acme.network");

  const storageOnly = Capability.EnvironmentLive(new Map([[Storage.id, available("storage-1")]]));
  const networkOnly = Capability.EnvironmentLive(new Map([[Network.id, available("network-1")]]));

  it("merging two Environment layers keeps only the later map; the earlier map's ids resolve Unavailable", async () => {
    expect((await resolveAll(Layer.merge(storageOnly, networkOnly), [Storage, Network])).map(summary)).toEqual(["Unavailable", "network-1"]);
  });

  it("the order decides which map survives: the later one, never a union", async () => {
    expect((await resolveAll(Layer.merge(networkOnly, storageOnly), [Storage, Network])).map(summary)).toEqual(["storage-1", "Unavailable"]);
  });

  it("for an id both maps supply, the later map's implementation is the one resolved", async () => {
    const storageAgain = Capability.EnvironmentLive(new Map([[Storage.id, available("storage-2")]]));

    expect((await resolveAll(Layer.merge(storageOnly, storageAgain), [Storage])).map(summary)).toEqual(["storage-2"]);
  });

  it("control: one Environment built from one map supplies every id in it", async () => {
    const both = Capability.EnvironmentLive(new Map([[Storage.id, available("storage-1")], [Network.id, available("network-1")]]));

    expect((await resolveAll(both, [Storage, Network])).map(summary)).toEqual(["storage-1", "network-1"]);
  });
});

describe("Characterization: capability identity is the id string (v0.7 D53, R21)", () => {
  interface Bytes { readonly bytes: () => number }
  interface Text { readonly text: () => string }

  it("two capabilities defined with the same id resolve the same implementation, whatever their Shapes", async () => {
    const AsBytes = Capability.define<Bytes>("acme.blob");
    const AsText = Capability.define<Text>("acme.blob");
    const implementation = { bytes: () => 3, text: () => "abc" };

    const [bytes, text] = await resolveAll(Capability.EnvironmentLive(new Map([["acme.blob", available(implementation)]])), [AsBytes, AsText]);

    expect(bytes).toEqual({ _tag: "Available", implementation });
    expect(text).toEqual({ _tag: "Available", implementation });
    expect(bytes?._tag === "Available" && text?._tag === "Available" && bytes.implementation === text.implementation).toBe(true);
  });

  it("control: capabilities with different ids resolve independently", async () => {
    const Left = Capability.define<string>("acme.left");
    const Right = Capability.define<string>("acme.right");

    expect((await resolveAll(Capability.EnvironmentLive(new Map([[Left.id, available("left")]])), [Left, Right])).map(summary)).toEqual(["left", "Unavailable"]);
  });
});
