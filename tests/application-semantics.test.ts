import { Effect, Either, Layer, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";

import * as Application from "../src/application/index.js";
import * as Capability from "../src/capability/index.js";
import * as Command from "../src/command/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Semantic from "../src/semantic/index.js";
import * as Service from "../src/service/index.js";

// v0.8: application semantics (outline Revision 2, C24–C28, D56–D67, I39–I43).
// Requirements are owned by units: the start unit (the service graph build) and
// admitted units (effects run through the runtime, typically commands). Each unit
// is one standalone Semantic.Declaration. Nothing here attaches a requirement to
// a primitive, and nothing in NEXUS reads one.
//
// Four things stay separate throughout:
//   start-unit necessity          the start unit's declared requirement      (C27)
//   application requirement set   the C26 union over the units described     (C26)
//   runtime capability resolution what the platform Layer built              (I36)
//   static compatibility verdict  Semantic.analyze over declarations × statement
//
// Declaration ids are local to their context (D65). They deliberately differ from
// the Command and Application names of the code they describe: no mapping between
// the two is part of the contract. A context contains the units its producer chose
// to describe, never necessarily all of them (O13 deferred).

interface NetworkShape { readonly get: (url: string) => ReadonlyArray<string> }
interface StorageShape { readonly read: (key: string) => string }

const Network = Capability.define<NetworkShape>("acme.network");
const Storage = Capability.define<StorageShape>("acme.storage");

interface UserRepositoryShape { readonly list: () => Effect.Effect<ReadonlyArray<string>, Capability.CapabilityUnavailableError> }

const UserRepository = Service.define<UserRepositoryShape>("UserRepository");

// Captures the Environment when built; needs Network only when a method runs.
const Http = Service.layer(UserRepository, Effect.map(Capability.Environment, (environment): UserRepositoryShape => ({
  list: () => Capability.require(Network).pipe(
    Effect.provideService(Capability.Environment, environment),
    Effect.map((network) => network.get("/users"))
  ),
})));

const InMemory = Service.layerSync(UserRepository, (): UserRepositoryShape => ({ list: () => Effect.succeed(["ada", "grace"]) }));

const listUsers = Command.define("users.list", Schema.Struct({}), () => Effect.flatMap(UserRepository, (repository) => repository.list()));

type Resolutions = ReadonlyMap<string, Capability.CapabilityResolution<unknown>>;

const none: Resolutions = new Map();
const storageImplementation: StorageShape = { read: (key) => `stored:${key}` };
const withStorage: Resolutions = new Map([[Storage.id, { _tag: "Available", implementation: storageImplementation }]]);

// A platform provision statement (v0.7 D47): plain data.
const statement = (provided: ReadonlyArray<string>, notProvided: ReadonlyArray<string>): Semantic.TargetProfile => ({ name: "platform-statement", provided, notProvided });

const requires = (...capabilities: ReadonlyArray<string>): Semantic.TargetRequirements => ({ completeness: "complete", capabilities: capabilities.map((capability) => ({ capability })) });

const analyzed = (context: Semantic.AnalysisContext) => {
  const outcome = Semantic.analyze(context);
  if (outcome._tag !== "Analyzed") throw new Error("expected Analyzed");
  return outcome;
};

const classifications = (outcome: ReturnType<typeof analyzed>) => outcome.operations.map((operation) => [operation.id, operation.classification]);

// Starts an application on a platform supplying `resolutions`, runs `body`, and shuts down with the scope.
const withApplication = <R, A>(
  name: string,
  runtime: Layer.Layer<R, unknown, Application.ApplicationAmbient>,
  resolutions: Resolutions,
  body: (running: Application.RunningApplication<R>) => Effect.Effect<A, never, Scope.Scope>
): Promise<A> => Effect.runPromise(Effect.scoped(Effect.flatMap(
  Application.start(Application.define({ name, runtime }), { platform: Capability.EnvironmentLive(resolutions) }).pipe(Effect.orDie),
  body
)));

const run = <R, A, E>(running: Application.RunningApplication<R>, effect: Effect.Effect<A, E, R | Capability.EnvironmentShape>) =>
  Effect.promise(() => Runtime.run(running.runtime, Effect.either(effect)));

const listUnder = (runtime: Layer.Layer<UserRepositoryShape, never, Capability.EnvironmentShape>) =>
  withApplication("composition", runtime, none, (running) => run(running, Command.invoke(listUsers, {})));

describe("Application semantics: characterizations (v0.8)", () => {
  it("the same Command value behaves differently under two compositions (Y3, I42)", async () => {
    const http = await listUnder(Http);
    const inMemory = await listUnder(InMemory);

    expect(Either.isLeft(http) && http.left._tag).toBe("CapabilityUnavailableError");
    expect(inMemory).toEqual(Either.right(["ada", "grace"]));
  });

  it("two compositions are two contexts, and analyzing either changes neither behavior (C24)", async () => {
    const profile = statement([], [Network.id]);
    // One admitted unit per context, described for that context's composition.
    const httpContext = analyzed({ declarations: [{ id: "unit-list", requirements: requires(Network.id) }], profile });
    const inMemoryContext = analyzed({ declarations: [{ id: "unit-list", requirements: requires() }], profile });

    expect(classifications(httpContext)).toEqual([["unit-list", "incompatible"]]);
    expect(classifications(inMemoryContext)).toEqual([["unit-list", "supported"]]);

    const http = await listUnder(Http);
    const inMemory = await listUnder(InMemory);

    expect(Either.isLeft(http) && http.left._tag).toBe("CapabilityUnavailableError");
    expect(inMemory).toEqual(Either.right(["ada", "grace"]));
  });

  it("overlapping units are accepted and undetected: Semantic has no containment (C25, Y2)", () => {
    const outcome = Semantic.analyze({
      declarations: [
        { id: "whole", requirements: requires(Storage.id) },
        { id: "list", requirements: requires(Network.id) },
      ],
      profile: statement([Storage.id], [Network.id]),
    });

    expect(outcome._tag).toBe("Analyzed");
    expect(outcome._tag === "Analyzed" && classifications(outcome)).toEqual([["whole", "supported"], ["list", "incompatible"]]);
    // Nothing in the outcome relates the two units.
    expect(outcome._tag === "Analyzed" && Object.keys(outcome).sort()).toEqual(["_tag", "diagnostics", "operations", "profile", "properties", "required"]);
    expect(outcome._tag === "Analyzed" && outcome.operations.map((operation) => Object.keys(operation).sort())).toEqual([
      ["classification", "id", "known", "verdict"],
      ["classification", "id", "known", "verdict"],
    ]);
  });

  it("one unit, one declaration: a second declaration of the same unit is rejected (D62, C9)", () => {
    const outcome = Semantic.analyze({
      declarations: [
        { id: "unit-save", requirements: requires(Storage.id) },
        { id: "unit-save", requirements: requires(Network.id) },
      ],
      profile: statement([], []),
    });

    expect(outcome).toEqual({ _tag: "Rejected", issues: [{ reason: "duplicate-identity", path: ["declarations", 1, "id"] }] });
  });
});

// C26, as local test tooling only (D61, D66): not exported, not in src/. It reads
// the public outcome for classifications, and the plain-data declarations this
// file wrote for requirement occurrences. It reads no runtime value, and gives no
// verdict cause. Its result is relative to the units the context describes.
interface Aggregate {
  readonly capabilities: ReadonlyArray<string>;
  readonly occurrences: ReadonlyArray<{ readonly unit: string; readonly capability: string; readonly provenance: Semantic.Location }>;
  readonly completeness: "complete" | "partial";
  readonly classification: Semantic.Classification;
}

const rank: Record<Semantic.Classification, number> = { supported: 0, opaque: 1, incompatible: 2 };

const aggregate = (outcome: ReturnType<typeof analyzed>, declarations: ReadonlyArray<Semantic.Declaration>): Aggregate => {
  const capabilities: Array<string> = [];
  const occurrences: Array<Aggregate["occurrences"][number]> = [];
  for (const declaration of declarations) {
    for (const requirement of declaration.requirements?.capabilities ?? []) {
      if (!capabilities.includes(requirement.capability)) capabilities.push(requirement.capability);
      occurrences.push({
        unit: declaration.id,
        capability: requirement.capability,
        provenance: requirement.provenance === undefined ? { _tag: "Unlocated" } : { _tag: "Span", span: { ...requirement.provenance } },
      });
    }
  }
  // An undeclared unit contributes partial-empty, never "absent".
  const completeness = declarations.every((declaration) => declaration.requirements?.completeness === "complete") ? "complete" : "partial";
  const classification = outcome.operations.reduce<Semantic.Classification>((worst, operation) => rank[operation.classification] > rank[worst] ? operation.classification : worst, "supported");

  return { capabilities, occurrences, completeness, classification };
};

// The union, as one declaration: C26's set with C26's completeness.
const unionOf = (declarations: ReadonlyArray<Semantic.Declaration>): Semantic.Declaration => {
  const result = aggregate({ _tag: "Analyzed", properties: [], required: [], profile: "", operations: [], diagnostics: [] }, declarations);
  return { id: "union", requirements: { completeness: result.completeness, capabilities: result.capabilities.map((capability) => ({ capability })) } };
};

const span = (source: string, start: number, end: number): Semantic.Span => ({ source, start, end });

describe("Application semantics: the aggregation algebra (v0.8 C26)", () => {
  it("the worst unit classification equals C4's classification of the union, exhaustively (Y1)", () => {
    const subsets: ReadonlyArray<ReadonlyArray<string>> = [[], ["a"], ["b"], ["a", "b"]];
    const states: ReadonlyArray<Semantic.TargetRequirements | undefined> = [
      undefined,
      ...subsets.map((ids): Semantic.TargetRequirements => ({ completeness: "complete", capabilities: ids.map((capability) => ({ capability })) })),
      ...subsets.map((ids): Semantic.TargetRequirements => ({ completeness: "partial", capabilities: ids.map((capability) => ({ capability })) })),
    ];
    const decisions = ["provided", "notProvided", "undecided"] as const;
    const profiles = decisions.flatMap((a) => decisions.map((b) => statement(
      [...(a === "provided" ? ["a"] : []), ...(b === "provided" ? ["b"] : [])],
      [...(a === "notProvided" ? ["a"] : []), ...(b === "notProvided" ? ["b"] : [])]
    )));
    const lists: Array<ReadonlyArray<Semantic.TargetRequirements | undefined>> = [[]];
    for (const x of states) {
      lists.push([x]);
      for (const y of states) {
        lists.push([x, y]);
        for (const z of states) lists.push([x, y, z]);
      }
    }

    let cases = 0;
    const mismatches: Array<unknown> = [];
    for (const profile of profiles) {
      for (const list of lists) {
        const declarations = list.map((requirements, i): Semantic.Declaration => requirements === undefined ? { id: `u${i}` } : { id: `u${i}`, requirements });
        const perUnit = aggregate(analyzed({ declarations, profile }), declarations).classification;
        const union = analyzed({ declarations: [unionOf(declarations)], profile }).operations[0]?.classification;
        cases += 1;
        if (perUnit !== union) mismatches.push({ list, profile, perUnit, union });
      }
    }

    expect(cases).toBe(7380);
    expect(mismatches).toEqual([]);
  });

  it("counter-check: an undeclared unit taken as absent would hide an incompatible unit (partial-empty rule)", () => {
    const profile = statement([], ["a"]);
    const declarations: ReadonlyArray<Semantic.Declaration> = [{ id: "u0" }, { id: "u1", requirements: requires("a") }];

    expect(aggregate(analyzed({ declarations, profile }), declarations).classification).toBe("incompatible");
    expect(analyzed({ declarations: [unionOf(declarations)], profile }).operations[0]?.classification).toBe("incompatible");
    // Absent requirements on the union: the wrong rule.
    expect(analyzed({ declarations: [{ id: "union" }], profile }).operations[0]?.classification).toBe("opaque");
  });

  it("orders the set by first occurrence: declaration order, then capability order", () => {
    const declarations: ReadonlyArray<Semantic.Declaration> = [
      { id: "unit-1", requirements: requires("b") },
      { id: "unit-2", requirements: requires("a", "b") },
      { id: "unit-3", requirements: requires("c", "a") },
    ];

    expect(aggregate(analyzed({ declarations, profile: statement([], []) }), declarations).capabilities).toEqual(["b", "a", "c"]);
  });

  it("keeps every occurrence of a duplicate across units, attributed to its unit, with its span", () => {
    const declarations: ReadonlyArray<Semantic.Declaration> = [
      { id: "unit-save", requirements: { completeness: "complete", capabilities: [{ capability: Storage.id, provenance: span("app.ts", 10, 20) }] } },
      { id: "unit-load", requirements: { completeness: "complete", capabilities: [{ capability: Storage.id, provenance: span("app.ts", 40, 52) }, { capability: Network.id }] } },
    ];
    const result = aggregate(analyzed({ declarations, profile: statement([Storage.id, Network.id], []) }), declarations);

    expect(result.capabilities).toEqual([Storage.id, Network.id]);
    expect(result.occurrences).toEqual([
      { unit: "unit-save", capability: Storage.id, provenance: { _tag: "Span", span: span("app.ts", 10, 20) } },
      { unit: "unit-load", capability: Storage.id, provenance: { _tag: "Span", span: span("app.ts", 40, 52) } },
      { unit: "unit-load", capability: Network.id, provenance: { _tag: "Unlocated" } },
    ]);
    expect(result.classification).toBe("supported");
  });

  it("a partial unit opens the aggregate: opaque, unless some unit is incompatible (C4 step 1 first)", () => {
    const partial: Semantic.Declaration = { id: "unit-sync", requirements: { completeness: "partial", capabilities: [{ capability: Network.id }] } };
    const complete: Semantic.Declaration = { id: "unit-save", requirements: requires(Storage.id) };
    const provided = statement([Storage.id, Network.id], []);
    const storageRefused = statement([Network.id], [Storage.id]);

    const opened = aggregate(analyzed({ declarations: [partial, complete], profile: provided }), [partial, complete]);
    expect([opened.completeness, opened.classification]).toEqual(["partial", "opaque"]);

    const refused = aggregate(analyzed({ declarations: [partial, complete], profile: storageRefused }), [partial, complete]);
    expect([refused.completeness, refused.classification]).toEqual(["partial", "incompatible"]);
  });

  it("an empty context is vacuously supported: complete-empty, relative to the units described", () => {
    const result = aggregate(analyzed({ declarations: [], profile: statement([], [Storage.id]) }), []);

    expect(result).toEqual({ capabilities: [], occurrences: [], completeness: "complete", classification: "supported" });
  });
});
