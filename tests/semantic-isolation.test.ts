// v0.4: semantic analysis is pure and independent of execution (outline I11, I12,
// I15, I16, I19; C7; D3, D10, D15). These tests import existing primitives only
// to exercise them next to analysis; nothing here changes them.
import type { RuntimeDiagnostic, RuntimeDiagnosticsDocument } from "@valancex/mesh-runtime";
import type * as Mesh from "../src/mesh/index.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Layer, Ref, Schema } from "effect";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import * as Application from "../src/application/index.js";
import * as Capability from "../src/capability/index.js";
import * as Command from "../src/command/index.js";
import * as Resource from "../src/resource/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Selector from "../src/selector/index.js";
import * as Service from "../src/service/index.js";
import * as State from "../src/state/index.js";
import * as Semantic from "../src/semantic/index.js";

// Test fixtures only: these capability ids are not a vocabulary (plan P9).
const context = (): Semantic.AnalysisContext => ({
  declarations: [
    { id: "supported", name: "Save", provenance: { source: "app.ts", start: 0, end: 10 }, requirements: { completeness: "complete", capabilities: [{ capability: "fs", provenance: { source: "app.ts", start: 2, end: 4 } }] } },
    { id: "opaque", requirements: { completeness: "partial", capabilities: [{ capability: "fs" }] } },
    { id: "undecided", requirements: { completeness: "complete", capabilities: [{ capability: "gpu" }, { capability: "gpu" }] } },
    { id: "incompatible", provenance: { source: "app.ts", start: 20, end: 30 }, requirements: { completeness: "complete", capabilities: [{ capability: "net", provenance: { source: "app.ts", start: 22, end: 25 } }] } },
    { id: "undeclared" },
  ],
  profile: { name: "isolation", provenance: { source: "profile.json", start: 0, end: 5 }, provided: ["fs"], notProvided: ["net"] },
  require: ["target-compatibility"],
});

// The fields the analysis may read (plan: "Reads").
const modeled = new Set([
  "declarations", "profile", "require",
  "id", "name", "provenance", "requirements",
  "completeness", "capabilities", "capability",
  "provided", "notProvided",
  "source", "start", "end",
  "length",
]);

describe("Semantic: purity (I11, C7)", () => {
  it("reads only the modeled fields, and never enumerates, iterates, writes or calls", () => {
    const events: Array<string> = [];
    const wrap = <T>(value: T): T => {
      if (typeof value !== "object" || value === null) return value;
      const wrapped = Array.isArray(value) ? value.map(wrap) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wrap(v)]));

      return new Proxy(wrapped, {
        get: (target, key, receiver) => {
          events.push(`get:${String(key)}`);
          return Reflect.get(target, key, receiver);
        },
        has: (target, key) => { events.push(`has:${String(key)}`); return Reflect.has(target, key); },
        ownKeys: (target) => { events.push("ownKeys"); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor: (target, key) => { events.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
        set: (target, key, v) => { events.push(`set:${String(key)}`); return Reflect.set(target, key, v); },
        defineProperty: (target, key, d) => { events.push(`define:${String(key)}`); return Reflect.defineProperty(target, key, d); },
        deleteProperty: (target, key) => { events.push(`delete:${String(key)}`); return Reflect.deleteProperty(target, key); },
      }) as T;
    };

    const outcome = Semantic.analyze(wrap(context()));

    expect(outcome._tag).toBe("Analyzed");
    expect(events.length).toBeGreaterThan(0);
    const unexpected = events.filter((event) => {
      if (!event.startsWith("get:")) return true;
      const key = event.slice(4);
      return !modeled.has(key) && !/^\d+$/.test(key);
    });
    expect(unexpected).toEqual([]);
  });

  it("never invokes a value it is given", () => {
    const calls: Array<string> = [];
    const trap = (name: string) => () => { calls.push(name); throw new Error(`${name} was called`); };
    const armed = <T extends object>(value: T): T => Object.assign(value, {
      then: trap("then"), toJSON: trap("toJSON"), valueOf: trap("valueOf"), toString: trap("toString"), handler: trap("handler"),
    });
    const c = context();
    const input: Semantic.AnalysisContext = armed({
      declarations: c.declarations.map((d) => armed({
        ...d,
        ...(d.provenance ? { provenance: armed({ ...d.provenance }) } : {}),
        ...(d.requirements ? { requirements: armed({ ...d.requirements, capabilities: d.requirements.capabilities.map((r) => armed({ ...r, ...(r.provenance ? { provenance: armed({ ...r.provenance }) } : {}) })) }) } : {}),
      })),
      profile: armed({ ...c.profile, ...(c.profile.provenance ? { provenance: armed({ ...c.profile.provenance }) } : {}) }),
      require: c.require ?? [],
    });

    const outcome = Semantic.analyze(input);

    expect(outcome._tag).toBe("Analyzed");
    expect(calls).toEqual([]);
  });

  it("never mutates its input: a deep-frozen context analyzes, and is unchanged", () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === "object" && value !== null) {
        for (const v of Object.values(value)) deepFreeze(v);
        Object.freeze(value);
      }
      return value;
    };
    // An unsorted, multi-element list, so an in-place reorder would be a real write.
    const input = deepFreeze({ ...context(), profile: { ...context().profile, provided: ["zz", "fs", "aa"] } });
    const before = structuredClone(input);

    expect(Semantic.analyze(input)._tag).toBe("Analyzed");
    expect(input).toStrictEqual(before);
  });

  it("is synchronous: the result is a plain outcome, not a thenable", () => {
    const outcome = Semantic.analyze(context());

    expect(outcome._tag).toBe("Analyzed");
    expect("then" in outcome).toBe(false);
  });

  it("uses no ambient platform channel (DoD 9, C7)", () => {
    const text = readFileSync(fileURLToPath(new URL("../src/semantic/index.ts", import.meta.url)), "utf8");
    const words = ["process", "globalThis", "window", "navigator", "Date", "performance", "setTimeout", "setInterval", "queueMicrotask", "fetch", "XMLHttpRequest", "WebSocket"];
    const substrings = ["Math.random", "require(", "/// <reference"];

    expect(words.filter((word) => new RegExp(`\\b${word}\\b`).test(text))).toEqual([]);
    expect(substrings.filter((substring) => text.includes(substring))).toEqual([]);
  });
});

describe("Semantic: no discovery (DoD 8, 9; I16)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const baseline = () => Semantic.analyze(context());

  it("gives equal outcomes with the environment, platform, host and clock varied", () => {
    const expected = baseline();

    vi.stubEnv("NEXUS_TARGET", "browser");
    vi.stubEnv("NODE_ENV", "production");
    expect(Semantic.analyze(context())).toStrictEqual(expected);

    const platform = Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor;
    try {
      Object.defineProperty(process, "platform", { value: "browser", configurable: true });
      expect(Semantic.analyze(context())).toStrictEqual(expected);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }

    const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      Object.defineProperty(globalThis, "navigator", { value: { userAgent: "probe", hardwareConcurrency: 1 }, configurable: true });
      expect(Semantic.analyze(context())).toStrictEqual(expected);
    } finally {
      if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2001-01-01T00:00:00Z"));
    expect(Semantic.analyze(context())).toStrictEqual(expected);
    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    expect(Semantic.analyze(context())).toStrictEqual(expected);
  });

  it("touches no environment variable, clock, randomness or network while it runs", () => {
    const input = context();
    const envReads: Array<PropertyKey> = [];
    const env = process.env;
    const now = vi.spyOn(Date, "now");
    const perf = vi.spyOn(performance, "now");
    const random = vi.spyOn(Math, "random");
    const fetchCalls: Array<unknown> = [];
    const realFetch = globalThis.fetch;

    try {
      process.env = new Proxy(env, { get: (target, key) => { envReads.push(key); return Reflect.get(target, key); } });
      globalThis.fetch = ((...args: Array<unknown>) => { fetchCalls.push(args); throw new Error("fetch"); }) as typeof fetch;
      Semantic.analyze(input);
    } finally {
      process.env = env;
      globalThis.fetch = realFetch;
    }

    expect(envReads).toEqual([]);
    expect(now).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it("a profile reaches analysis only through the context", () => {
    // Never passed to analyze; it must have no effect.
    const unused: Semantic.TargetProfile = { name: "unused", provided: [], notProvided: ["fs", "gpu"] };
    const outcome = Semantic.analyze(context());

    expect(unused.name).toBe("unused");
    if (outcome._tag !== "Analyzed") throw new Error("expected Analyzed");
    expect(outcome.profile).toBe("isolation");
    expect(outcome.operations.find((o) => o.id === "supported")?.classification).toBe("supported");
  });
});

describe("Semantic: independence from execution (DoD 3, 10, 11, 12; I11, I15, D10)", () => {
  it("executes no implementation next to its declarations (DoD 10)", async () => {
    const calls: Array<string> = [];
    const recorder = (name: string) => () => { calls.push(name); throw new Error(`${name} ran`); };

    const Save = Command.define("save", Schema.Struct({}), () => Effect.sync(recorder("handler")));
    const Store = Service.define<{ readonly save: () => void }>("Store");
    const StoreLive = Service.layerSync(Store, recorder("service"));
    const file = Resource.acquire({ acquire: Effect.sync(recorder("acquire")), release: () => Effect.sync(recorder("release")) });
    const state = await Effect.runPromise(Effect.scoped(State.create(Schema.Number, 0)));
    const count = Selector.define(state, recorder("projection"));

    const outcome = Semantic.analyze({
      declarations: [
        { id: "save", name: Save.name, requirements: { completeness: "complete", capabilities: [{ capability: "fs" }] } },
        { id: "store" },
        { id: "file", requirements: { completeness: "partial", capabilities: [{ capability: "fs" }] } },
        { id: "count" },
      ],
      profile: { name: "p", provided: ["fs"], notProvided: [] },
    });

    expect(outcome._tag).toBe("Analyzed");
    expect([StoreLive, file, count].every((x) => x !== undefined)).toBe(true);
    expect(calls).toEqual([]);

    // Control: the recorders do record when something calls them.
    expect(() => recorder("control")()).toThrow();
    expect(calls).toEqual(["control"]);
  });

  it("Effect type parameters are not semantic metadata (DoD 11)", () => {
    const A = Command.define<{}, void, never, never>("same", Schema.Struct({}), () => Effect.void);
    const B = Command.define<{}, void, { readonly _tag: "Oops" }, Capability.EnvironmentShape>("same", Schema.Struct({}), () => Effect.void);
    const declare = (command: { readonly name: string }, id: string): Semantic.Declaration =>
      ({ id, name: command.name, requirements: { completeness: "complete", capabilities: [{ capability: "fs" }] } });
    const p: Semantic.TargetProfile = { name: "p", provided: [], notProvided: ["fs"] };

    expect(Semantic.analyze({ declarations: [declare(A, "x")], profile: p })).toStrictEqual(Semantic.analyze({ declarations: [declare(B, "x")], profile: p }));

    // Control: a different declaration does change the outcome.
    expect(Semantic.analyze({ declarations: [{ id: "x", name: "same" }], profile: p })).not.toStrictEqual(Semantic.analyze({ declarations: [declare(B, "x")], profile: p }));
  });

  describe("application capability is not target capability (DoD 12, I15)", () => {
    interface FileSystem { readonly read: () => string }
    const Fs = Capability.define<FileSystem>("filesystem");
    const declaration: Semantic.Declaration = { id: "reader", requirements: { completeness: "complete", capabilities: [{ capability: "filesystem" }] } };

    const resolutions = async (resolution: Capability.CapabilityResolution<unknown>, analyze: boolean) =>
      Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const running = yield* Application.start(Application.define({ name: "cap", runtime: Layer.empty, environment: new Map([["filesystem", resolution]]) }));
        if (analyze) Semantic.analyze({ declarations: [declaration], profile: { name: "p", provided: ["filesystem"], notProvided: [] } });
        const resolved = yield* Effect.promise(() => Runtime.run(running.runtime, Capability.resolve(Fs)));
        const required = yield* Effect.promise(() => Runtime.run(running.runtime, Effect.either(Capability.require(Fs))));
        return { resolved: resolved._tag, required: required._tag };
      })));

    const classify = (p: Semantic.TargetProfile) => {
      const outcome = Semantic.analyze({ declarations: [declaration], profile: p });
      if (outcome._tag !== "Analyzed") throw new Error("expected Analyzed");
      return outcome.operations[0]?.classification;
    };

    it("Unavailable application capability, target provides it: supported", async () => {
      const unavailable: Capability.CapabilityResolution<unknown> = { _tag: "Unavailable", reason: "not here" };

      expect(classify({ name: "p", provided: ["filesystem"], notProvided: [] })).toBe("supported");
      expect(await resolutions(unavailable, true)).toEqual(await resolutions(unavailable, false));
      expect(await resolutions(unavailable, true)).toEqual({ resolved: "Unavailable", required: "Left" });
    });

    it("Available application capability, target doesn't provide it: incompatible", async () => {
      const available: Capability.CapabilityResolution<unknown> = { _tag: "Available", implementation: { read: () => "x" }, source: "native" };

      expect(classify({ name: "p", provided: [], notProvided: ["filesystem"] })).toBe("incompatible");
      expect(await resolutions(available, true)).toEqual(await resolutions(available, false));
      expect(await resolutions(available, true)).toEqual({ resolved: "Available", required: "Right" });
    });

    it("control: swapping the profile's lists flips both verdicts", () => {
      expect(classify({ name: "p", provided: [], notProvided: ["filesystem"] })).toBe("incompatible");
      expect(classify({ name: "p", provided: ["filesystem"], notProvided: [] })).toBe("supported");
    });
  });

  it("an opaque operation still executes exactly as without analysis (DoD 3, D10)", async () => {
    const Echo = Command.define("echo", Schema.Struct({ n: Schema.Number }), (input) => Effect.succeed(input.n * 2));
    const run = (analyze: boolean) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const running = yield* Application.start(Application.define({ name: "opaque", runtime: Layer.empty }));
      if (analyze) {
        const outcome = Semantic.analyze({ declarations: [{ id: "echo" }], profile: { name: "p", provided: [], notProvided: ["fs", "net"] } });
        if (outcome._tag !== "Analyzed" || outcome.operations[0]?.classification !== "opaque") throw new Error("expected opaque");
      }
      return yield* Effect.promise(() => Runtime.run(running.runtime, Effect.exit(Command.invoke(Echo, { n: 21 }))));
    })));

    const withAnalysis = await run(true);
    const without = await run(false);

    expect(Exit.isSuccess(withAnalysis) && withAnalysis.value).toBe(42);
    expect(withAnalysis).toStrictEqual(without);
  });
});

describe("Semantic: MESH's diagnostic contract is intact (DoD 13, D15)", () => {
  it("MeshDiagnostics is unchanged, and NEXUS diagnostics are not MESH's", () => {
    expectTypeOf<Mesh.MeshDiagnostics>().toEqualTypeOf<{ readonly _tag: "MeshDiagnostics"; readonly diagnostics: RuntimeDiagnosticsDocument }>();
    expectTypeOf<Semantic.Diagnostic>().not.toEqualTypeOf<RuntimeDiagnostic>();
  });

  it("every NEXUS code is namespaced, and none is a MESH code", () => {
    const outcome = Semantic.analyze(context());
    if (outcome._tag !== "Analyzed") throw new Error("expected Analyzed");
    const codes = outcome.diagnostics.map((d) => d.code);

    expect(new Set(codes)).toEqual(new Set(["nexus-incompatible-target-capability", "nexus-opaque-operation", "nexus-undetermined-target-capability"]));
    for (const code of codes) {
      expect(code.startsWith("nexus-")).toBe(true);
      expect(["runtime-unknown-field", "runtime-handler-other-program", "runtime-value-mismatch"]).not.toContain(code);
    }
  });
});

describe("Semantic: the lifecycle holds (DoD 15, I19)", () => {
  it("analysis concurrent with shutdown leaves the lifecycle unchanged", async () => {
    const expected = Semantic.analyze(context());

    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const releases = yield* Ref.make(0);
      const running = yield* Application.start(Application.define({
        name: "lifecycle",
        runtime: Layer.scopedDiscard(Effect.addFinalizer(() => Ref.update(releases, (n) => n + 1))),
      }));
      const [outcome] = yield* Effect.all([Effect.sync(() => Semantic.analyze(context())), Application.shutdown(running)], { concurrency: "unbounded" });

      return { outcome, status: yield* Application.status(running), released: yield* Ref.get(releases) };
    })));

    expect(result.status).toEqual({ _tag: "Stopped" });
    expect(result.released).toBe(1);
    expect(result.outcome).toStrictEqual(expected);
  });
});
