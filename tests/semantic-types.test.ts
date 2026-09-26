// v0.4: the semantic model's public boundary, at compile time (outline C1, I13,
// I15, I18). Checked by `pnpm typecheck`: every `@ts-expect-error` must be
// needed, and every `expectTypeOf` must hold.
//
// TypeScript is structural, so a value held in a variable with extra
// properties, or a class instance whose fields exactly match a slot, is
// assignable. That case is covered at runtime by tests/semantic.test.ts
// (fresh output) and tests/semantic-isolation.test.ts (modeled reads only).
import { Context, Effect, Schema } from "effect";
import { describe, expectTypeOf, it } from "vitest";

import * as Capability from "../src/capability/index.js";
import * as Command from "../src/command/index.js";
import type * as Semantic from "../src/semantic/index.js";

// Compile-time only: `accept<T>(value)` type-checks exactly when value is a T.
const accept = <T>(_value: T): void => undefined;

const aFunction = () => 1;
const anEffect = Effect.succeed(1);
const anError = new Error("x");
const aMap = new Map([["fs", 1]]);
const aSet = new Set(["fs"]);
const aDate = new Date(0);
const aCommand = Command.define("c", Schema.Struct({}), () => Effect.void);
const aCapability = Capability.define<{ readonly read: () => string }>("filesystem");

describe("Semantic types: every input slot rejects executable and non-plain values (C1)", () => {
  it(`Declaration["id"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Declaration["id"]
    accept<Semantic.Declaration["id"]>(aCapability);
  });

  it(`Declaration["name"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Declaration["name"]
    accept<Semantic.Declaration["name"]>(aCapability);
  });

  it(`Declaration["provenance"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Declaration["provenance"]
    accept<Semantic.Declaration["provenance"]>(aCapability);
  });

  it(`Declaration["requirements"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Declaration["requirements"]
    accept<Semantic.Declaration["requirements"]>(aCapability);
  });

  it(`Requirement["capability"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Requirement["capability"]
    accept<Semantic.Requirement["capability"]>(aCapability);
  });

  it(`Requirement["provenance"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Requirement["provenance"]
    accept<Semantic.Requirement["provenance"]>(aCapability);
  });

  it(`TargetRequirements["completeness"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.TargetRequirements["completeness"]
    accept<Semantic.TargetRequirements["completeness"]>(aCapability);
  });

  it(`TargetRequirements["capabilities"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.TargetRequirements["capabilities"]
    accept<Semantic.TargetRequirements["capabilities"]>(aCapability);
  });

  it(`Span["source"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Span["source"]
    accept<Semantic.Span["source"]>(aCapability);
  });

  it(`Span["start"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Span["start"]
    accept<Semantic.Span["start"]>(aCapability);
  });

  it(`Span["end"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.Span["end"]
    accept<Semantic.Span["end"]>(aCapability);
  });

  it(`TargetProfile["name"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.TargetProfile["name"]
    accept<Semantic.TargetProfile["name"]>(aCapability);
  });

  it(`TargetProfile["provenance"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.TargetProfile["provenance"]
    accept<Semantic.TargetProfile["provenance"]>(aCapability);
  });

  it(`TargetProfile["provided"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.TargetProfile["provided"]
    accept<Semantic.TargetProfile["provided"]>(aCapability);
  });

  it(`TargetProfile["notProvided"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.TargetProfile["notProvided"]
    accept<Semantic.TargetProfile["notProvided"]>(aCapability);
  });

  it(`AnalysisContext["declarations"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.AnalysisContext["declarations"]
    accept<Semantic.AnalysisContext["declarations"]>(aCapability);
  });

  it(`AnalysisContext["profile"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.AnalysisContext["profile"]
    accept<Semantic.AnalysisContext["profile"]>(aCapability);
  });

  it(`AnalysisContext["require"] rejects executable and non-plain values`, () => {
    // @ts-expect-error: aFunction is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(aFunction);
    // @ts-expect-error: anEffect is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(anEffect);
    // @ts-expect-error: anError is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(anError);
    // @ts-expect-error: aMap is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(aMap);
    // @ts-expect-error: aSet is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(aSet);
    // @ts-expect-error: aDate is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(aDate);
    // @ts-expect-error: aCommand is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(aCommand);
    // @ts-expect-error: aCapability is not plain data for Semantic.AnalysisContext["require"]
    accept<Semantic.AnalysisContext["require"]>(aCapability);
  });
});

describe("Semantic types: whole NEXUS values don't fit (DoD 10–12, I15)", () => {
  it("Command, Capability, CapabilityResolution and EnvironmentShape are not declarations, profiles or contexts", () => {
    type C = Command.Command<{}, void, never, never>;
    type Cap = Capability.Capability<{ readonly read: () => string }>;
    type Res = Capability.CapabilityResolution<unknown>;
    type Env = Capability.EnvironmentShape;

    expectTypeOf<C>().not.toMatchTypeOf<Semantic.Declaration>();
    expectTypeOf<C>().not.toMatchTypeOf<Semantic.TargetProfile>();
    expectTypeOf<C>().not.toMatchTypeOf<Semantic.AnalysisContext>();
    // Open point (see the plan's "As built"): a Capability is `{ id: string; tag }`, and a
    // Declaration requires only `id: string`, so TypeScript's structural typing accepts a
    // Capability where a Declaration is expected. No assertion is made here until that is
    // decided. At runtime, analysis reads only a declaration's modeled fields (semantic-isolation).
    expectTypeOf<Cap>().not.toMatchTypeOf<Semantic.TargetProfile>();
    expectTypeOf<Cap>().not.toMatchTypeOf<Semantic.AnalysisContext>();
    expectTypeOf<Res>().not.toMatchTypeOf<Semantic.Declaration>();
    expectTypeOf<Res>().not.toMatchTypeOf<Semantic.TargetProfile>();
    expectTypeOf<Res>().not.toMatchTypeOf<Semantic.AnalysisContext>();
    expectTypeOf<Env>().not.toMatchTypeOf<Semantic.Declaration>();
    expectTypeOf<Env>().not.toMatchTypeOf<Semantic.TargetProfile>();
    expectTypeOf<Env>().not.toMatchTypeOf<Semantic.AnalysisContext>();
  });
});

// True only for strings, numbers, booleans, their literal unions, and readonly
// arrays and object types of these. Arrays are handled before objects, so
// array methods don't count. The depth bound (far deeper than the model) keeps
// the controls from recursing forever through Effect's recursive types.
type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
type IsPlainData<T, D extends number = 10> =
  [D] extends [never] ? false
    : [T] extends [string | number | boolean] ? true
    : T extends (...args: never) => unknown ? false
    : T extends ReadonlyArray<infer E> ? IsPlainData<E, Depth[D]>
    : T extends ReadonlyMap<unknown, unknown> | ReadonlySet<unknown> | Date | Error | Promise<unknown> | Context.Tag<unknown, unknown> ? false
    : T extends object ? (false extends { [K in keyof T]-?: IsPlainData<Exclude<T[K], undefined>, Depth[D]> }[keyof T] ? false : true)
    : false;

describe("Semantic types: outputs and inputs are plain data (I13, I18)", () => {
  it("every public model type is plain data", () => {
    expectTypeOf<IsPlainData<Semantic.AnalysisOutcome>>().toEqualTypeOf<true>();
    expectTypeOf<IsPlainData<Semantic.Diagnostic>>().toEqualTypeOf<true>();
    expectTypeOf<IsPlainData<Semantic.RejectionIssue>>().toEqualTypeOf<true>();
    expectTypeOf<IsPlainData<Semantic.OperationResult>>().toEqualTypeOf<true>();
    expectTypeOf<IsPlainData<Semantic.AnalysisContext>>().toEqualTypeOf<true>();
  });

  it("controls: the check rejects what it should", () => {
    expectTypeOf<IsPlainData<Command.Command<{}, void, never, never>>>().toEqualTypeOf<false>();
    expectTypeOf<IsPlainData<Effect.Effect<number>>>().toEqualTypeOf<false>();
    expectTypeOf<IsPlainData<{ readonly a: ReadonlySet<string> }>>().toEqualTypeOf<false>();
    expectTypeOf<IsPlainData<{ readonly a: Date }>>().toEqualTypeOf<false>();
    expectTypeOf<IsPlainData<{ readonly a: symbol }>>().toEqualTypeOf<false>();
    expectTypeOf<IsPlainData<{ readonly a: bigint }>>().toEqualTypeOf<false>();
    expectTypeOf<IsPlainData<{ readonly a: () => void }>>().toEqualTypeOf<false>();
  });
});
