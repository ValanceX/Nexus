import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import * as Application from "../src/application/index.js";
import * as Capability from "../src/capability/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Semantic from "../src/semantic/index.js";

// v0.7: the platform binding (outline D43–D46, C19, C20, C23). Semantic is
// unchanged; these tests pin what its relation means when the requirement side
// names application capability ids and the profile is a platform's provision
// statement. The only link is the id string, written here, outside NEXUS
// modules (C19).

interface StorageShape { readonly read: (key: string) => string }
interface NetworkShape { readonly get: (url: string) => string }

const Storage = Capability.define<StorageShape>("acme.storage");
const Network = Capability.define<NetworkShape>("acme.network");

const span = (source: string, start: number, end: number): Semantic.Span => ({ source, start, end });

const requires = (...capabilities: ReadonlyArray<Semantic.Requirement>): Semantic.TargetRequirements => ({ completeness: "complete", capabilities });

const analyzed = (context: Semantic.AnalysisContext) => {
  const outcome = Semantic.analyze(context);
  if (outcome._tag !== "Analyzed") throw new Error("expected Analyzed");
  return outcome;
};

// A platform's provision statement (D47): plain data, authored by the platform.
const statement = (provided: ReadonlyArray<string>, notProvided: ReadonlyArray<string>, provenance?: Semantic.Span): Semantic.TargetProfile =>
  provenance === undefined ? { name: "platform-statement", provided, notProvided } : { name: "platform-statement", provenance, provided, notProvided };

describe("Capability model: the platform binding (v0.7 D44, C19, C20)", () => {
  it("supported: every required capability id is provided", () => {
    const outcome = analyzed({
      declarations: [{ id: "sync", requirements: requires({ capability: Storage.id }, { capability: Network.id }) }],
      profile: statement([Storage.id, Network.id], []),
      require: ["target-compatibility"],
    });

    expect(outcome.operations).toEqual([{ id: "sync", known: ["target-requirements"], verdict: { _tag: "Compatible" }, classification: "supported" }]);
    expect(outcome.diagnostics).toEqual([]);
  });

  it("incompatible: a required id the statement explicitly doesn't provide, with exactly one error and its related spans", () => {
    const outcome = analyzed({
      declarations: [{
        id: "save",
        name: "Save",
        provenance: span("app.ts", 100, 160),
        requirements: requires({ capability: Storage.id, provenance: span("app.ts", 120, 132) }),
      }],
      profile: statement([], [Storage.id], span("platform.json", 0, 40)),
    });

    expect(outcome.operations).toEqual([{ id: "save", known: ["target-requirements"], verdict: { _tag: "Incompatible", notProvided: ["acme.storage"] }, classification: "incompatible" }]);
    expect(outcome.diagnostics).toHaveLength(1);
    const [diagnostic] = outcome.diagnostics;
    expect(diagnostic?.code).toBe("nexus-incompatible-target-capability");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.subject).toBe("save");
    expect(diagnostic?.location).toEqual({ _tag: "Span", span: span("app.ts", 100, 160) });
    expect(diagnostic?.related).toEqual([
      { span: span("app.ts", 120, 132), label: "requirement declared here" },
      { span: span("platform.json", 0, 40), label: "target profile declared here" },
    ]);
  });

  it("opaque: a required id the statement leaves undecided is target-undetermined, never incompatible", () => {
    const outcome = analyzed({
      declarations: [{ id: "save", requirements: requires({ capability: Storage.id }) }],
      profile: statement([], []),
      require: ["target-compatibility"],
    });

    expect(outcome.operations).toEqual([{ id: "save", known: ["target-requirements"], verdict: { _tag: "Undetermined", cause: "target", undecided: ["acme.storage"] }, classification: "opaque" }]);
    expect(outcome.diagnostics.map((d) => [d.code, d.severity])).toEqual([["nexus-undetermined-target-capability", "warning"]]);
  });

  it("granularity is the producer's: one whole-application declaration gives the verdict of the union", () => {
    const profile = statement([Network.id], [Storage.id]);
    const whole = analyzed({ declarations: [{ id: "app", requirements: requires({ capability: Storage.id }, { capability: Network.id }) }], profile });
    const split = analyzed({
      declarations: [
        { id: "save", requirements: requires({ capability: Storage.id }) },
        { id: "fetch", requirements: requires({ capability: Network.id }) },
      ],
      profile,
    });

    expect(whole.operations.map((o) => o.classification)).toEqual(["incompatible"]);
    expect(split.operations.map((o) => [o.id, o.classification])).toEqual([["save", "incompatible"], ["fetch", "supported"]]);
  });
});

describe("Capability model: a requirement means necessity, not use (v0.7 D46, C23)", () => {
  // Uses Storage, with an explicit fallback: works without it.
  const readOrDefault = Effect.map(Capability.resolve(Storage), (resolution) => resolution._tag === "Available" ? resolution.implementation.read("k") : "default");
  // Uses Storage with no fallback: can't work without it.
  const readOrFail = Effect.map(Capability.require(Storage), (storage) => storage.read("k"));

  const profile = statement([], [Storage.id]);

  it("resolve with a fallback, declared as requiring nothing, is supported against a statement not providing it", () => {
    const outcome = analyzed({ declarations: [{ id: "read-or-default", requirements: requires() }], profile });

    expect(outcome.operations[0]?.classification).toBe("supported");
    expect(outcome.diagnostics).toEqual([]);
  });

  it("referencing a capability in code declares nothing: undeclared requirements are opaque, never incompatible", () => {
    const outcome = analyzed({ declarations: [{ id: "read-or-default" }], profile });

    expect(outcome.operations[0]?.verdict).toEqual({ _tag: "Undetermined", cause: "operation", requirements: "undeclared" });
    expect(outcome.operations[0]?.classification).toBe("opaque");
  });

  it("control: the declared requirement, not the code, makes it incompatible", () => {
    const outcome = analyzed({
      declarations: [
        { id: "read-or-fail", requirements: requires({ capability: Storage.id }) },
        // The same fallback code, mis-declared as a requirement: the declaration decides.
        { id: "read-or-default-misdeclared", requirements: requires({ capability: Storage.id }) },
      ],
      profile,
    });

    expect(outcome.operations.map((o) => o.classification)).toEqual(["incompatible", "incompatible"]);
  });

  it("the code behaves as written on a platform that doesn't provide Storage: the fallback runs, require fails", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const running = yield* Application.start(Application.define({ name: "necessity", runtime: Layer.empty }), { platform: Capability.EnvironmentLive(new Map()) });
      return yield* Effect.promise(() => Promise.all([
        Runtime.run(running.runtime, readOrDefault),
        Runtime.run(running.runtime, Effect.either(readOrFail)),
      ]));
    })));

    expect(result[0]).toBe("default");
    expect(Either.isLeft(result[1]) && result[1].left._tag).toBe("CapabilityUnavailableError");
  });
});

describe("Capability model: identity is the exact id (v0.7 D44, D53, I34)", () => {
  it("Capability.define(\"acme.storage\") is the semantic identifier \"acme.storage\", verbatim", () => {
    const Defined = Capability.define<StorageShape>("acme.storage");
    const built = Semantic.build({ declarations: [{ id: "op", requirements: requires({ capability: Defined.id }) }], profile: statement([], []) });

    expect(Defined.id).toBe("acme.storage");
    expect(built._tag === "Built" && built.operations[0]?.requirements).toEqual({
      _tag: "Declared",
      completeness: "complete",
      capabilities: [{ capability: "acme.storage", provenance: { _tag: "Unlocated" } }],
    });
  });

  it("changing the id changes the relation", () => {
    const Renamed = Capability.define<StorageShape>("acme.storage.v2");
    const profile = statement([], [Storage.id]);

    const verdict = (capability: Capability.Capability<StorageShape>) =>
      analyzed({ declarations: [{ id: "op", requirements: requires({ capability: capability.id }) }], profile }).operations[0]?.verdict;

    expect(verdict(Storage)).toEqual({ _tag: "Incompatible", notProvided: ["acme.storage"] });
    expect(verdict(Renamed)).toEqual({ _tag: "Undetermined", cause: "target", undecided: ["acme.storage.v2"] });
  });

  it("changing the TypeScript binding's name doesn't: equal ids give equal outcomes", () => {
    const LocalDisk = Capability.define<StorageShape>("acme.storage");
    const RemoteBucket = Capability.define<StorageShape>("acme.storage");
    const context = (capability: Capability.Capability<StorageShape>): Semantic.AnalysisContext => ({
      declarations: [{ id: "op", requirements: requires({ capability: capability.id }) }],
      profile: statement([], [Storage.id]),
      require: ["target-compatibility"],
    });

    expect(Semantic.analyze(context(LocalDisk))).toStrictEqual(Semantic.analyze(context(RemoteBucket)));
    expect(Semantic.analyze(context(LocalDisk))).toStrictEqual(Semantic.analyze(context(Storage)));
  });

  it("ids are compared exactly: case and prefixes are different identifiers", () => {
    const outcome = analyzed({
      declarations: [{ id: "op", requirements: requires({ capability: Storage.id }) }],
      profile: statement(["Acme.Storage", "storage"], ["acme.storage "]),
    });

    expect(outcome.operations[0]?.verdict).toEqual({ _tag: "Undetermined", cause: "target", undecided: ["acme.storage"] });
  });
});

describe("Capability model: a claim is not a fact, and analysis is not enforcement (v0.7 I15, I36, I37)", () => {
  const declaration: Semantic.Declaration = { id: "save", requirements: requires({ capability: Storage.id }) };
  const statements = {
    supported: statement([Storage.id], []),
    incompatible: statement([], [Storage.id]),
    opaque: statement([], []),
  } as const;

  const implementation: StorageShape = { read: (key) => `stored:${key}` };
  const layers = {
    Available: new Map<string, Capability.CapabilityResolution<unknown>>([[Storage.id, { _tag: "Available", implementation }]]),
    Unavailable: new Map<string, Capability.CapabilityResolution<unknown>>([[Storage.id, { _tag: "Unavailable", reason: "the Layer supplies none" }]]),
  } as const;

  // Analyze, then start on the given Layer and observe status and resolution.
  const observe = (profile: Semantic.TargetProfile, resolutions: ReadonlyMap<string, Capability.CapabilityResolution<unknown>>) =>
    Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const before = Semantic.analyze({ declarations: [declaration], profile, require: ["target-compatibility"] });
      const running = yield* Application.start(Application.define({ name: "independence", runtime: Layer.empty }), { platform: Capability.EnvironmentLive(resolutions) });
      const status = yield* Application.status(running);
      const [resolved, required] = yield* Effect.promise(() => Promise.all([
        Runtime.run(running.runtime, Capability.resolve(Storage)),
        Runtime.run(running.runtime, Effect.either(Capability.require(Storage))),
      ]));
      const after = Semantic.analyze({ declarations: [declaration], profile, require: ["target-compatibility"] });
      return { classification: before._tag === "Analyzed" ? before.operations[0]?.classification : undefined, status, resolved, required, before, after };
    })));

  it("Semantic says incompatible, the Layer provides Available: the application starts and resolves Available", async () => {
    const observed = await observe(statements.incompatible, layers.Available);

    expect(observed.classification).toBe("incompatible");
    expect(observed.status).toEqual({ _tag: "Running" });
    expect(observed.resolved).toEqual({ _tag: "Available", implementation });
    expect(observed.resolved._tag === "Available" && observed.resolved.implementation).toBe(implementation);
    expect(Either.isRight(observed.required) && observed.required.right.read("k")).toBe("stored:k");
  });

  it("Semantic says supported, the Layer provides Unavailable: the application starts and resolves Unavailable", async () => {
    const observed = await observe(statements.supported, layers.Unavailable);

    expect(observed.classification).toBe("supported");
    expect(observed.status).toEqual({ _tag: "Running" });
    expect(observed.resolved).toEqual({ _tag: "Unavailable", reason: "the Layer supplies none" });
    expect(observed.required).toEqual(Either.left({ _tag: "CapabilityUnavailableError", id: "acme.storage", reason: "the Layer supplies none" }));
  });

  for (const verdict of ["supported", "incompatible", "opaque"] as const) {
    for (const supplied of ["Available", "Unavailable"] as const) {
      it(`${verdict} × Layer ${supplied}: start is unaffected, resolution is exactly the Layer's, and the analysis is unchanged by starting`, async () => {
        const observed = await observe(statements[verdict], layers[supplied]);

        expect(observed.classification).toBe(verdict);
        expect(observed.status).toEqual({ _tag: "Running" });
        expect(observed.resolved).toEqual(layers[supplied].get(Storage.id));
        expect(Either.isRight(observed.required)).toBe(supplied === "Available");
        expect(observed.after).toStrictEqual(observed.before);
      });
    }
  }
});
