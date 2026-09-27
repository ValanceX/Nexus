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
