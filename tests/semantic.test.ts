// v0.4: the semantic model (outline C1–C7, D4–D12).
import { describe, expect, expectTypeOf, it } from "vitest";

import * as Semantic from "../src/semantic/index.js";

describe("Semantic: the public model (C1–C7)", () => {
  it("has exactly the three C6 codes, two severities and three classifications", () => {
    expectTypeOf<Semantic.DiagnosticCode>().toEqualTypeOf<"nexus-incompatible-target-capability" | "nexus-opaque-operation" | "nexus-undetermined-target-capability">();
    expectTypeOf<Semantic.Severity>().toEqualTypeOf<"warning" | "error">();
    expectTypeOf<Semantic.Classification>().toEqualTypeOf<"supported" | "opaque" | "incompatible">();
  });

  it("has exactly D6's five rejection reasons", () => {
    expectTypeOf<Semantic.RejectionReason>().toEqualTypeOf<"duplicate-identity" | "missing-identity" | "invalid-span" | "empty-capability" | "conflicting-decision">();
  });

  it("has exactly one property and one required fact", () => {
    expectTypeOf<Semantic.Property>().toEqualTypeOf<"target-requirements">();
    expectTypeOf<Semantic.RequiredFact>().toEqualTypeOf<"target-compatibility">();
  });

  it("analyze is a plain synchronous function, not an Effect (D11)", () => {
    expectTypeOf(Semantic.analyze).parameter(0).toEqualTypeOf<Semantic.AnalysisContext>();
    expectTypeOf(Semantic.analyze).returns.toEqualTypeOf<Semantic.AnalysisOutcome>();
  });

  it("identity is a plain string (D4)", () => {
    expectTypeOf<Semantic.Declaration["id"]>().toEqualTypeOf<string>();
  });

  it("a rejection issue shares no field with a diagnostic (D6, C7)", () => {
    expectTypeOf<keyof Semantic.RejectionIssue>().toEqualTypeOf<"reason" | "path">();
    expectTypeOf<keyof Semantic.Diagnostic>().toEqualTypeOf<"code" | "severity" | "message" | "location" | "subject" | "related" | "notes">();
  });

  it("exports exactly one runtime value, analyze", () => {
    expect(Object.keys(Semantic)).toEqual(["analyze"]);
  });
});
