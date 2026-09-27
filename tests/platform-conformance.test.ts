import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

import { conformance } from "./platform/conformance.js";
import { referencePlatform } from "./platform/reference.js";

// v0.7 C21: platform conformance is test infrastructure. These tests check the
// helper itself: both drift directions are reported, undecided never is.

const Storage = Nexus.Capability.define<string>("acme.storage");
const Network = Nexus.Capability.define<string>("acme.network");
const Camera = Nexus.Capability.define<string>("acme.camera");
const Gpu = Nexus.Capability.define<string>("acme.gpu");

const available = (implementation: unknown): Nexus.Capability.CapabilityResolution<unknown> => ({ _tag: "Available", implementation });
const unavailable = (reason: string): Nexus.Capability.CapabilityResolution<unknown> => ({ _tag: "Unavailable", reason });

const platformOf = (entries: ReadonlyArray<readonly [string, Nexus.Capability.CapabilityResolution<unknown>]>) =>
  referencePlatform({ resolutions: new Map(entries) });

describe("Conformance (test tooling, v0.7 C21)", () => {
  it("1. a reference platform whose statement matches its Layer conforms", async () => {
    const platform = platformOf([[Storage.id, available("s")], [Network.id, available("n")], [Gpu.id, unavailable("no gpu")]]);

    // Gpu explicitly Unavailable, Camera not mentioned: both honour notProvided.
    expect(await conformance(platform, { provided: [Storage.id, Network.id], notProvided: [Gpu.id, Camera.id] })).toEqual([]);
  });

  it("2. provided but Unavailable is reported, with the platform's reason, whether explicit or unmentioned", async () => {
    const platform = platformOf([[Storage.id, unavailable("disk offline")]]);

    expect(await conformance(platform, { provided: [Storage.id, Network.id], notProvided: [] })).toEqual([
      { _tag: "ProvidedButUnavailable", id: "acme.storage", reason: "disk offline" },
      { _tag: "ProvidedButUnavailable", id: "acme.network", reason: "no resolution registered for 'acme.network'" },
    ]);
  });

  it("3. notProvided but Available is reported", async () => {
    const platform = platformOf([[Gpu.id, available("g")]]);

    expect(await conformance(platform, { provided: [], notProvided: [Gpu.id] })).toEqual([{ _tag: "NotProvidedButAvailable", id: "acme.gpu" }]);
  });

  it("4. an undecided id is never reported, whatever the Layer supplies for it", async () => {
    const platform = platformOf([[Camera.id, available("c")], [Gpu.id, unavailable("no gpu")]]);

    // The statement decides nothing about Camera or Gpu (permission- or hardware-dependent).
    expect(await conformance(platform, { provided: [], notProvided: [] })).toEqual([]);
    expect(await conformance(platform, { provided: [Camera.id], notProvided: [] })).toEqual([]);
    expect(await conformance(platform, { provided: [], notProvided: [Gpu.id] })).toEqual([]);
  });

  it("5. several capabilities: every failure, each distinct id once, provided first, in statement order", async () => {
    const platform = platformOf([[Storage.id, available("s")], [Network.id, unavailable("offline")], [Gpu.id, available("g")], [Camera.id, available("c")]]);

    expect(await conformance(platform, {
      provided: [Network.id, Storage.id, Network.id, "acme.missing"],
      notProvided: [Camera.id, Gpu.id, Camera.id],
    })).toEqual([
      { _tag: "ProvidedButUnavailable", id: "acme.network", reason: "offline" },
      { _tag: "ProvidedButUnavailable", id: "acme.missing", reason: "no resolution registered for 'acme.missing'" },
      { _tag: "NotProvidedButAvailable", id: "acme.camera" },
      { _tag: "NotProvidedButAvailable", id: "acme.gpu" },
    ]);
  });

  it("6. ids are compared exactly: case, whitespace and prefixes are different ids", async () => {
    const platform = platformOf([[Storage.id, available("s")]]);

    expect(await conformance(platform, { provided: ["Acme.Storage", "acme.storage ", "storage"], notProvided: [] })).toEqual([
      { _tag: "ProvidedButUnavailable", id: "Acme.Storage", reason: "no resolution registered for 'Acme.Storage'" },
      { _tag: "ProvidedButUnavailable", id: "acme.storage ", reason: "no resolution registered for 'acme.storage '" },
      { _tag: "ProvidedButUnavailable", id: "storage", reason: "no resolution registered for 'storage'" },
    ]);
    // The exact id conforms, in both directions.
    expect(await conformance(platform, { provided: ["acme.storage"], notProvided: ["Acme.Storage"] })).toEqual([]);
  });

  it("checks what a scoped platform supplies on this start, and releases it", async () => {
    const log: Array<string> = [];
    const scoped: Nexus.Application.Platform = Layer.scoped(Nexus.Capability.Environment, Effect.acquireRelease(
      Effect.sync(() => (log.push("acquire"), { resolutions: new Map([[Storage.id, available("s")]]) })),
      () => Effect.sync(() => void log.push("release"))
    ));

    expect(await conformance(scoped, { provided: [Storage.id], notProvided: [Network.id] })).toEqual([]);
    expect(log).toEqual(["acquire", "release"]);
  });

  it("is not part of the package: no entry namespace exposes a conformance value", () => {
    for (const namespace of Object.values(Nexus)) expect(Object.keys(namespace)).not.toContain("conformance");
  });
});
