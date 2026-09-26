// v0.4: the semantic model (outline C1–C7, D4–D12).
import { describe, expect, expectTypeOf, it } from "vitest";

import * as Semantic from "../src/semantic/index.js";

// Every outcome produced in this file goes through this helper, so Task 8 can
// check that each one survives a JSON round trip.
const recorded: Array<Semantic.AnalysisOutcome> = [];
const analyzeAndRecord = (context: Semantic.AnalysisContext): Semantic.AnalysisOutcome => {
  const outcome = Semantic.analyze(context);
  recorded.push(outcome);
  return outcome;
};

// Test fixtures only: these capability ids are not a vocabulary (plan P9).
const span = (source: string, start: number, end: number): Semantic.Span => ({ source, start, end });
const profile = (provided: ReadonlyArray<string> = [], notProvided: ReadonlyArray<string> = [], extra: Partial<Semantic.TargetProfile> = {}): Semantic.TargetProfile =>
  ({ name: "test-profile", provided, notProvided, ...extra });
const complete = (...capabilities: ReadonlyArray<string | Semantic.Requirement>): Semantic.TargetRequirements =>
  ({ completeness: "complete", capabilities: capabilities.map((c) => typeof c === "string" ? { capability: c } : c) });
const partial = (...capabilities: ReadonlyArray<string | Semantic.Requirement>): Semantic.TargetRequirements =>
  ({ completeness: "partial", capabilities: capabilities.map((c) => typeof c === "string" ? { capability: c } : c) });

const issuesOf = (outcome: Semantic.AnalysisOutcome) => {
  if (outcome._tag !== "Rejected") throw new Error(`expected Rejected, got ${outcome._tag}`);
  return outcome.issues;
};
const analyzedOf = (outcome: Semantic.AnalysisOutcome) => {
  if (outcome._tag !== "Analyzed") throw new Error(`expected Analyzed, got ${JSON.stringify(outcome)}`);
  return outcome;
};

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

describe("Semantic: malformed contexts are rejected (D6)", () => {
  it("case 1: a repeated identity is reported at every later occurrence", () => {
    const outcome = analyzeAndRecord({ declarations: [{ id: "a" }, { id: "a" }, { id: "a" }], profile: profile() });

    expect(issuesOf(outcome)).toEqual([
      { reason: "duplicate-identity", path: ["declarations", 1, "id"] },
      { reason: "duplicate-identity", path: ["declarations", 2, "id"] },
    ]);
  });

  it("case 2: an empty identity is missing, and two empty identities are not duplicates", () => {
    const outcome = analyzeAndRecord({ declarations: [{ id: "" }, { id: "" }], profile: profile() });

    expect(issuesOf(outcome)).toEqual([
      { reason: "missing-identity", path: ["declarations", 0, "id"] },
      { reason: "missing-identity", path: ["declarations", 1, "id"] },
    ]);
  });

  describe("case 3: invalid spans", () => {
    const at = (s: Semantic.Span) => ({
      declaration: { declarations: [{ id: "a", provenance: s }], profile: profile() },
      requirement: { declarations: [{ id: "a", requirements: complete({ capability: "fs", provenance: s }) }], profile: profile(["fs"]) },
      profile: { declarations: [], profile: profile([], [], { provenance: s }) },
    });
    const paths = {
      declaration: ["declarations", 0, "provenance"],
      requirement: ["declarations", 0, "requirements", "capabilities", 0, "provenance"],
      profile: ["profile", "provenance"],
    };
    const sites = ["declaration", "requirement", "profile"] as const;

    it.each(sites)("end < start on the %s span", (site) => {
      expect(issuesOf(analyzeAndRecord(at(span("f", 5, 4))[site]))).toEqual([{ reason: "invalid-span", path: paths[site] }]);
    });

    it.each(sites)("an empty source on the %s span", (site) => {
      expect(issuesOf(analyzeAndRecord(at(span("", 0, 1))[site]))).toEqual([{ reason: "invalid-span", path: paths[site] }]);
    });

    it.each([NaN, Infinity, -Infinity, -0])("start = %s on the declaration span", (value) => {
      expect(issuesOf(analyzeAndRecord(at(span("f", value, 10)).declaration))).toEqual([{ reason: "invalid-span", path: paths.declaration }]);
    });

    it.each([NaN, Infinity, -Infinity, -0])("end = %s on the declaration span", (value) => {
      expect(issuesOf(analyzeAndRecord(at(span("f", -10, value)).declaration))).toEqual([{ reason: "invalid-span", path: paths.declaration }]);
    });

    it.each(["requirement", "profile"] as const)("NaN and -0 on the %s span", (site) => {
      expect(issuesOf(analyzeAndRecord(at(span("f", NaN, 1))[site]))).toEqual([{ reason: "invalid-span", path: paths[site] }]);
      expect(issuesOf(analyzeAndRecord(at(span("f", -0, 1))[site]))).toEqual([{ reason: "invalid-span", path: paths[site] }]);
    });

    it("a span with several faults gives one issue", () => {
      expect(issuesOf(analyzeAndRecord(at(span("", NaN, -1)).declaration))).toEqual([{ reason: "invalid-span", path: paths.declaration }]);
    });

    it("a +0 point span is not rejected", () => {
      expect(analyzeAndRecord(at(span("f", 0, 0)).declaration)._tag).toBe("Analyzed");
    });
  });

  it("case 4: an empty capability id, wherever it appears, and never as a conflict", () => {
    const outcome = analyzeAndRecord({
      declarations: [{ id: "a", requirements: complete("") }],
      profile: profile([""], [""]),
    });

    expect(issuesOf(outcome)).toEqual([
      { reason: "empty-capability", path: ["declarations", 0, "requirements", "capabilities", 0, "capability"] },
      { reason: "empty-capability", path: ["profile", "provided", 0] },
      { reason: "empty-capability", path: ["profile", "notProvided", 0] },
    ]);
  });

  it("case 5: a capability decided both ways, once per id, at its first notProvided index", () => {
    const outcome = analyzeAndRecord({ declarations: [], profile: profile(["fs", "fs", "net"], ["gpu", "fs", "fs"]) });

    expect(issuesOf(outcome)).toEqual([{ reason: "conflicting-decision", path: ["profile", "notProvided", 1] }]);
  });

  it("reports every issue, in the fixed traversal order, and nothing else", () => {
    const outcome = analyzeAndRecord({
      declarations: [
        { id: "" },
        { id: "b", provenance: span("f", 2, 1) },
        { id: "b", requirements: complete("") },
      ],
      profile: profile(["fs"], ["fs"]),
    });

    expect(outcome).toEqual({
      _tag: "Rejected",
      issues: [
        { reason: "missing-identity", path: ["declarations", 0, "id"] },
        { reason: "invalid-span", path: ["declarations", 1, "provenance"] },
        { reason: "duplicate-identity", path: ["declarations", 2, "id"] },
        { reason: "empty-capability", path: ["declarations", 2, "requirements", "capabilities", 0, "capability"] },
        { reason: "conflicting-decision", path: ["profile", "notProvided", 0] },
      ],
    });
    expect(Object.keys(outcome)).toEqual(["_tag", "issues"]);
  });

  it("a rejection issue is not a diagnostic: its keys are exactly reason and path", () => {
    const outcome = analyzeAndRecord({ declarations: [{ id: "" }, { id: "a", provenance: span("", 0, 0) }], profile: profile([""], []) });

    for (const issue of issuesOf(outcome)) {
      expect(Object.keys(issue).sort()).toEqual(["path", "reason"]);
    }
  });

  describe("exactly five cases: everything else is analyzed", () => {
    const wellFormed: ReadonlyArray<readonly [string, Semantic.AnalysisContext]> = [
      ["no declarations", { declarations: [], profile: profile() }],
      ["a declaration with no facts", { declarations: [{ id: "a" }], profile: profile() }],
      ["an empty complete list", { declarations: [{ id: "a", requirements: complete() }], profile: profile() }],
      ["an empty partial list", { declarations: [{ id: "a", requirements: partial() }], profile: profile() }],
      ["duplicate ids in one requirement list", { declarations: [{ id: "a", requirements: complete("fs", "fs") }], profile: profile(["fs"]) }],
      ["an id repeated within provided and within notProvided", { declarations: [], profile: profile(["fs", "fs"], ["net", "net"]) }],
      ["a profile deciding nothing", { declarations: [{ id: "a", requirements: complete("fs") }], profile: profile() }],
      ["undecided and unknown ids", { declarations: [{ id: "a", requirements: complete("gpu") }], profile: profile(["unused"], ["other"]) }],
      ["an empty display name", { declarations: [{ id: "a", name: "" }], profile: profile() }],
      ["an empty profile name", { declarations: [{ id: "a" }], profile: profile([], [], { name: "" }) }],
      ["a point span", { declarations: [{ id: "a", provenance: span("f", 3, 3) }], profile: profile() }],
      ["finite negative offsets", { declarations: [{ id: "a", provenance: span("f", -3, -1) }], profile: profile() }],
      ["fractional offsets", { declarations: [{ id: "a", provenance: span("f", 0.5, 2.25) }], profile: profile() }],
      ["offsets beyond any plausible source", { declarations: [{ id: "a", provenance: span("f", 0, 1e9) }], profile: profile() }],
      ["two declarations sharing a display name", { declarations: [{ id: "a", name: "Save" }, { id: "b", name: "Save" }], profile: profile() }],
    ];

    it.each(wellFormed)("%s", (_label, context) => {
      expect(analyzeAndRecord(context)._tag).toBe("Analyzed");
    });
  });

  it("never throws on a malformed context", () => {
    expect(() => analyzeAndRecord({ declarations: [{ id: "" }, { id: "" }], profile: profile([""], [""], { provenance: span("", NaN, -0) }) })).not.toThrow();
  });
});

describe("Semantic: the outcome envelope (C7)", () => {
  it("records the property set, the required facts and the profile's name", () => {
    const base = { declarations: [{ id: "a" }, { id: "b" }], profile: profile([], [], { name: "node-22" }) };

    for (const [require, required] of [
      [undefined, []],
      [[], []],
      [["target-compatibility"], ["target-compatibility"]],
      [["target-compatibility", "target-compatibility"], ["target-compatibility"]],
    ] as const) {
      const outcome = analyzedOf(analyzeAndRecord(require === undefined ? base : { ...base, require }));

      expect(outcome.properties).toEqual(["target-requirements"]);
      expect(outcome.required).toEqual(required);
      expect(outcome.profile).toBe("node-22");
      expect(outcome.operations.map((o) => o.id)).toEqual(["a", "b"]);
    }
  });

  it("an empty profile name is echoed as given", () => {
    expect(analyzedOf(analyzeAndRecord({ declarations: [], profile: profile([], [], { name: "" }) })).profile).toBe("");
  });
});

describe("Semantic: supported (C4 compatible, C5)", () => {
  const supported = (id: string): Semantic.OperationResult =>
    ({ id, known: ["target-requirements"], verdict: { _tag: "Compatible" }, classification: "supported" });

  it("a complete, fully provided set is supported, with or without name and provenance (DoD 1)", () => {
    const outcome = analyzedOf(analyzeAndRecord({
      declarations: [
        { id: "a", requirements: complete("fs") },
        { id: "b", name: "Save", requirements: complete("fs", "net") },
        { id: "c", provenance: span("app.ts", 0, 10), requirements: complete({ capability: "net", provenance: span("app.ts", 2, 5) }) },
        { id: "d", name: "Load", provenance: span("app.ts", 10, 20), requirements: complete("fs") },
      ],
      profile: profile(["fs", "net"]),
    }));

    expect(outcome.operations).toEqual([supported("a"), supported("b"), supported("c"), supported("d")]);
  });

  it("an empty complete list is supported, whatever the profile", () => {
    for (const p of [profile(), profile(["fs"], ["net", "gpu"])]) {
      expect(analyzedOf(analyzeAndRecord({ declarations: [{ id: "a", requirements: complete() }], profile: p })).operations).toEqual([supported("a")]);
    }
  });

  it("duplicate requirements are evaluated once", () => {
    const outcome = analyzedOf(analyzeAndRecord({ declarations: [{ id: "a", requirements: complete("fs", "fs", "net") }], profile: profile(["fs", "net"]) }));

    expect(outcome.operations).toEqual([supported("a")]);
  });

  it("identity, not the display name, keys results (D4)", () => {
    const outcome = analyzedOf(analyzeAndRecord({
      declarations: [{ id: "a", name: "Save", requirements: complete("fs") }, { id: "b", name: "Save" }],
      profile: profile(["fs"]),
    }));

    expect(outcome.operations.map((o) => [o.id, o.classification])).toEqual([["a", "supported"], ["b", "opaque"]]);
  });
});
