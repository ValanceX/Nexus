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

describe("Semantic: opaque (C4 undetermined, C5; I12, I14, I16)", () => {
  const verdictsOf = (context: Semantic.AnalysisContext) => analyzedOf(analyzeAndRecord(context)).operations;

  it("a partial set with every id provided is opaque, operation-side, partial", () => {
    expect(verdictsOf({ declarations: [{ id: "a", requirements: partial("fs") }], profile: profile(["fs"]) })).toEqual([
      { id: "a", known: ["target-requirements"], verdict: { _tag: "Undetermined", cause: "operation", requirements: "partial" }, classification: "opaque" },
    ]);
  });

  it("an empty partial list is opaque, operation-side, partial (DoD 1)", () => {
    expect(verdictsOf({ declarations: [{ id: "a", requirements: partial() }], profile: profile() })).toEqual([
      { id: "a", known: ["target-requirements"], verdict: { _tag: "Undetermined", cause: "operation", requirements: "partial" }, classification: "opaque" },
    ]);
  });

  it("a complete set with an undecided id is opaque, target-side", () => {
    expect(verdictsOf({ declarations: [{ id: "a", requirements: complete("fs", "gpu") }], profile: profile(["fs"]) })).toEqual([
      { id: "a", known: ["target-requirements"], verdict: { _tag: "Undetermined", cause: "target", undecided: ["gpu"] }, classification: "opaque" },
    ]);
  });

  it("operation-side wins: a partial set with an undecided id is partial", () => {
    expect(verdictsOf({ declarations: [{ id: "a", requirements: partial("gpu") }], profile: profile() })[0]?.verdict)
      .toEqual({ _tag: "Undetermined", cause: "operation", requirements: "partial" });
  });

  it("duplicate undecided ids are listed once", () => {
    expect(verdictsOf({ declarations: [{ id: "a", requirements: complete("gpu", "net", "gpu") }], profile: profile(["net"]) })).toEqual([
      { id: "a", known: ["target-requirements"], verdict: { _tag: "Undetermined", cause: "target", undecided: ["gpu"] }, classification: "opaque" },
    ]);
  });

  it("undeclared requirements are unknown: opaque, operation-side, undeclared", () => {
    expect(verdictsOf({ declarations: [{ id: "a" }], profile: profile(["fs"], ["net"]) })).toEqual([
      { id: "a", known: [], verdict: { _tag: "Undetermined", cause: "operation", requirements: "undeclared" }, classification: "opaque" },
    ]);
  });

  it("unknown is not empty: undeclared is opaque, an empty complete set is supported", () => {
    expect(verdictsOf({ declarations: [{ id: "a" }, { id: "b", requirements: complete() }], profile: profile() }).map((o) => o.classification))
      .toEqual(["opaque", "supported"]);
  });

  it("DoD 3: no facts, against a profile that provides nothing it mentions, is opaque, never incompatible", () => {
    expect(verdictsOf({ declarations: [{ id: "a" }], profile: profile([], ["fs", "net", "gpu"]) })[0]?.classification).toBe("opaque");
  });

  it("names don't create knowledge (I14)", () => {
    expect(verdictsOf({ declarations: [{ id: "filesystem", name: "filesystem" }], profile: profile([], ["filesystem"]) })[0]?.verdict)
      .toEqual({ _tag: "Undetermined", cause: "operation", requirements: "undeclared" });
  });
});

describe("Semantic: incompatible (C4 incompatible; I16)", () => {
  const operationsOf = (context: Semantic.AnalysisContext) => analyzedOf(analyzeAndRecord(context)).operations;
  const incompatible = (id: string, notProvided: ReadonlyArray<string>): Semantic.OperationResult =>
    ({ id, known: ["target-requirements"], verdict: { _tag: "Incompatible", notProvided }, classification: "incompatible" });

  it("a complete set with a not-provided id is incompatible", () => {
    expect(operationsOf({ declarations: [{ id: "a", requirements: complete("fs", "net") }], profile: profile(["net"], ["fs"]) }))
      .toEqual([incompatible("a", ["fs"])]);
  });

  it("a partial set with a not-provided id is incompatible", () => {
    expect(operationsOf({ declarations: [{ id: "a", requirements: partial("fs") }], profile: profile([], ["fs"]) }))
      .toEqual([incompatible("a", ["fs"])]);
  });

  it("not-provided and undecided ids together: incompatible, listing only the not-provided", () => {
    expect(operationsOf({ declarations: [{ id: "a", requirements: complete("gpu", "fs") }], profile: profile([], ["fs"]) }))
      .toEqual([incompatible("a", ["fs"])]);
  });

  it("duplicate not-provided ids are listed once, in order of first occurrence", () => {
    expect(operationsOf({ declarations: [{ id: "a", requirements: complete("fs", "net", "fs", "db") }], profile: profile(["net"], ["db", "fs"]) }))
      .toEqual([incompatible("a", ["fs", "db"])]);
  });

  it("incompatibility needs proof: an unmentioned id is undecided, an explicitly not-provided one is incompatible", () => {
    const declarations = [{ id: "a", requirements: complete("gpu") }];

    expect(operationsOf({ declarations, profile: profile() })[0]?.verdict).toEqual({ _tag: "Undetermined", cause: "target", undecided: ["gpu"] });
    expect(operationsOf({ declarations, profile: profile([], ["gpu"]) })[0]?.verdict).toEqual({ _tag: "Incompatible", notProvided: ["gpu"] });
  });

  it("DoD 8: the same declarations against two contrasting profiles give each profile's verdicts", () => {
    const declarations = [{ id: "a", requirements: complete("fs") }];
    const a = analyzedOf(analyzeAndRecord({ declarations, profile: profile(["fs"], [], { name: "with-fs" }) }));
    const b = analyzedOf(analyzeAndRecord({ declarations, profile: profile([], ["fs"], { name: "without-fs" }) }));

    expect([a.profile, a.operations[0]?.classification]).toEqual(["with-fs", "supported"]);
    expect([b.profile, b.operations[0]?.classification]).toEqual(["without-fs", "incompatible"]);
  });
});

// The Task 7 matrix: one declaration per classification (and cause), each with provenance.
const matrixDeclarations: ReadonlyArray<Semantic.Declaration> = [
  { id: "supported", provenance: span("app.ts", 0, 10), requirements: complete("fs") },
  { id: "opaque-operation", provenance: span("app.ts", 10, 20), requirements: partial("fs") },
  { id: "opaque-target", provenance: span("app.ts", 20, 30), requirements: complete({ capability: "gpu", provenance: span("app.ts", 22, 25) }) },
  { id: "incompatible", provenance: span("app.ts", 30, 40), requirements: complete({ capability: "net", provenance: span("app.ts", 32, 35) }) },
];
const matrixProfile = profile(["fs"], ["net"], { name: "matrix", provenance: span("profile.json", 0, 50) });
const matrix = (require?: ReadonlyArray<Semantic.RequiredFact>) =>
  analyzedOf(analyzeAndRecord(require === undefined ? { declarations: matrixDeclarations, profile: matrixProfile } : { declarations: matrixDeclarations, profile: matrixProfile, require }));
const summary = (outcome: { readonly diagnostics: ReadonlyArray<Semantic.Diagnostic> }) => outcome.diagnostics.map((d) => [d.code, d.severity, d.subject]);

describe("Semantic: diagnostics (C5 emission, C6; I12, I17)", () => {
  it("emits exactly C5's diagnostics when nothing is required", () => {
    expect(summary(matrix())).toEqual([["nexus-incompatible-target-capability", "error", "incompatible"]]);
    expect(summary(matrix([]))).toEqual([["nexus-incompatible-target-capability", "error", "incompatible"]]);
  });

  it("emits exactly C5's diagnostics when target compatibility is required", () => {
    expect(summary(matrix(["target-compatibility"]))).toEqual([
      ["nexus-opaque-operation", "warning", "opaque-operation"],
      ["nexus-undetermined-target-capability", "warning", "opaque-target"],
      ["nexus-incompatible-target-capability", "error", "incompatible"],
    ]);
  });

  it("an undeclared operation warns (operation-side) only when compatibility is required", () => {
    const context = { declarations: [{ id: "a" }], profile: profile() };

    expect(summary(analyzedOf(analyzeAndRecord(context)))).toEqual([]);
    expect(summary(analyzedOf(analyzeAndRecord({ ...context, require: ["target-compatibility"] }))))
      .toEqual([["nexus-opaque-operation", "warning", "a"]]);
  });

  it("uses exactly the three codes and two severities; errors only with proof, warnings only for opaque", () => {
    const outcome = matrix(["target-compatibility"]);
    const byId = new Map(outcome.operations.map((o) => [o.id, o.classification]));

    expect(new Set(outcome.diagnostics.map((d) => d.code))).toEqual(new Set(["nexus-incompatible-target-capability", "nexus-opaque-operation", "nexus-undetermined-target-capability"]));
    expect(new Set(outcome.diagnostics.map((d) => d.severity))).toEqual(new Set(["warning", "error"]));
    for (const d of outcome.diagnostics) {
      expect(byId.get(d.subject)).toBe(d.severity === "error" ? "incompatible" : "opaque");
    }
  });

  it("gives at most one diagnostic per operation, duplicates included", () => {
    const outcome = analyzedOf(analyzeAndRecord({
      declarations: [{ id: "a", requirements: complete("net", "net") }, { id: "b", requirements: complete("gpu", "gpu") }],
      profile: profile([], ["net"]),
      require: ["target-compatibility"],
    }));

    expect(summary(outcome)).toEqual([
      ["nexus-incompatible-target-capability", "error", "a"],
      ["nexus-undetermined-target-capability", "warning", "b"],
    ]);
  });

  it("follows declaration order", () => {
    const reversed = analyzedOf(analyzeAndRecord({ declarations: [...matrixDeclarations].reverse(), profile: matrixProfile, require: ["target-compatibility"] }));

    expect(summary(reversed)).toHaveLength(3);
    expect(summary(reversed)).toEqual([...summary(matrix(["target-compatibility"]))].reverse());
  });

  it("every subject is its operation's identity, and joins to the operations", () => {
    const outcome = matrix(["target-compatibility"]);
    const ids = outcome.operations.map((o) => o.id);

    expect(outcome.diagnostics).toHaveLength(3);
    for (const d of outcome.diagnostics) expect(ids).toContain(d.subject);
  });

  it("the primary location is the declaration's span, or explicitly unlocated", () => {
    const located = matrix(["target-compatibility"]);
    for (const d of located.diagnostics) {
      expect(d.location).toEqual({ _tag: "Span", span: matrixDeclarations.find((x) => x.id === d.subject)?.provenance });
    }

    const unlocated = analyzedOf(analyzeAndRecord({
      declarations: [{ id: "a", requirements: complete({ capability: "net", provenance: span("app.ts", 1, 2) }) }],
      profile: profile([], ["net"], { provenance: span("profile.json", 0, 5) }),
    }));
    expect(unlocated.diagnostics).toHaveLength(1);
    expect(unlocated.diagnostics[0]?.location).toEqual({ _tag: "Unlocated" });
    expect(unlocated.diagnostics[0]?.subject).toBe("a");
    expect(Object.keys(unlocated.diagnostics[0] ?? {}).sort()).toEqual(["code", "location", "message", "notes", "related", "severity", "subject"]);
  });

  it("related spans: an error cites each not-provided occurrence in order, then the profile", () => {
    const outcome = analyzedOf(analyzeAndRecord({
      declarations: [{
        id: "a",
        requirements: complete(
          { capability: "fs", provenance: span("app.ts", 1, 2) },
          { capability: "ok", provenance: span("app.ts", 3, 4) },
          { capability: "net" },
          { capability: "fs", provenance: span("app.ts", 5, 6) },
        ),
      }],
      profile: profile(["ok"], ["fs", "net"], { provenance: span("profile.json", 0, 9) }),
    }));

    expect(outcome.diagnostics[0]?.related).toEqual([
      { span: span("app.ts", 1, 2), label: "requirement declared here" },
      { span: span("app.ts", 5, 6), label: "requirement declared here" },
      { span: span("profile.json", 0, 9), label: "target profile declared here" },
    ]);
  });

  it("related spans: an error against a profile without provenance cites only requirements", () => {
    const outcome = analyzedOf(analyzeAndRecord({ declarations: [{ id: "a", requirements: complete("fs") }], profile: profile([], ["fs"]) }));

    expect(outcome.diagnostics[0]?.related).toEqual([]);
  });

  it("related spans: a target-side warning cites each undecided occurrence, and nothing else", () => {
    const outcome = analyzedOf(analyzeAndRecord({
      declarations: [{
        id: "a",
        requirements: complete(
          { capability: "gpu", provenance: span("app.ts", 1, 2) },
          { capability: "fs", provenance: span("app.ts", 3, 4) },
          { capability: "gpu", provenance: span("app.ts", 5, 6) },
        ),
      }],
      profile: profile(["fs"], [], { provenance: span("profile.json", 0, 9) }),
      require: ["target-compatibility"],
    }));

    expect(outcome.diagnostics[0]?.related).toEqual([
      { span: span("app.ts", 1, 2), label: "requirement declared here" },
      { span: span("app.ts", 5, 6), label: "requirement declared here" },
    ]);
  });

  it("related spans: an operation-side warning cites nothing", () => {
    expect(matrix(["target-compatibility"]).diagnostics.find((d) => d.code === "nexus-opaque-operation")?.related).toEqual([]);
  });

  it("fabricates no span (I17)", () => {
    const inputSpans = [
      ...matrixDeclarations.flatMap((d) => [d.provenance, ...(d.requirements?.capabilities.map((r) => r.provenance) ?? [])]),
      matrixProfile.provenance,
    ].filter((s) => s !== undefined);
    const diagnostics = matrix(["target-compatibility"]).diagnostics;

    expect(diagnostics).toHaveLength(3);
    for (const d of diagnostics) {
      const spans = [...(d.location._tag === "Span" ? [d.location.span] : []), ...d.related.map((r) => r.span)];
      for (const s of spans) expect(inputSpans).toContainEqual(s);
    }
  });

  it("states findings as data: seven parts, a non-empty message and non-empty notes", () => {
    const diagnostics = matrix(["target-compatibility"]).diagnostics;

    expect(diagnostics).toHaveLength(3);
    for (const d of diagnostics) {
      expect(Object.keys(d).sort()).toEqual(["code", "location", "message", "notes", "related", "severity", "subject"]);
      expect(d.message).toEqual(expect.any(String));
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.notes.length).toBeGreaterThan(0);
      for (const note of d.notes) expect(note.length).toBeGreaterThan(0);
    }
  });
});

describe("Semantic: fresh, plain, deterministic output (I13, I17)", () => {
  const spansOf = (d: Semantic.Diagnostic) => [...(d.location._tag === "Span" ? [d.location.span] : []), ...d.related.map((r) => r.span)];

  it("every output span is a fresh { source, start, end }", () => {
    const declarationSpan = span("app.ts", 0, 10);
    const requirementSpan = span("app.ts", 2, 4);
    const profileSpan = span("profile.json", 0, 3);
    const outcome = analyzedOf(analyzeAndRecord({
      declarations: [{ id: "a", provenance: declarationSpan, requirements: complete({ capability: "fs", provenance: requirementSpan }) }],
      profile: profile([], ["fs"], { provenance: profileSpan }),
    }));
    const [location, requirement, prof] = spansOf(outcome.diagnostics[0] as Semantic.Diagnostic);

    expect([location, requirement, prof]).toEqual([declarationSpan, requirementSpan, profileSpan]);
    expect(location).not.toBe(declarationSpan);
    expect(requirement).not.toBe(requirementSpan);
    expect(prof).not.toBe(profileSpan);
    for (const s of [location, requirement, prof]) expect(Object.keys(s ?? {})).toEqual(["source", "start", "end"]);
  });

  it("forged extra properties on an input span are not propagated, and never called", () => {
    let called = 0;
    const forged = { ...span("app.ts", 1, 2), label: "x", excerpt: "fs()", nested: { a: 1 }, toJSON: () => { called++; return {}; } };
    const outcome = analyzedOf(analyzeAndRecord({ declarations: [{ id: "a", provenance: forged, requirements: complete("fs") }], profile: profile([], ["fs"]) }));

    expect(outcome.diagnostics[0]?.location).toStrictEqual({ _tag: "Span", span: { source: "app.ts", start: 1, end: 2 } });
    expect(called).toBe(0);
  });

  it("mutating the input after analysis doesn't change the outcome", () => {
    const provenance = { source: "app.ts", start: 1, end: 2 };
    const capabilities = [{ capability: "fs", provenance: { source: "app.ts", start: 3, end: 4 } }];
    const provided = ["net"];
    const notProvided = ["fs"];
    const declaration = { id: "a", name: "Save", provenance, requirements: { completeness: "complete" as const, capabilities } };
    const outcome = analyzeAndRecord({ declarations: [declaration], profile: { name: "p", provided, notProvided } });
    const before = structuredClone(outcome);

    provenance.start = 99; provenance.source = "changed";
    capabilities[0]!.provenance.end = 99; capabilities.push({ capability: "gpu", provenance: { source: "x", start: 0, end: 0 } });
    provided.push("fs"); notProvided.length = 0;
    declaration.id = "changed"; declaration.name = "changed";

    expect(outcome).toStrictEqual(before);
  });

  it("the same context gives the same outcome, and nothing is kept between calls", () => {
    const build = (): Semantic.AnalysisContext => ({ declarations: matrixDeclarations.map((d) => ({ ...d })), profile: { ...matrixProfile }, require: ["target-compatibility"] });
    const other: Semantic.AnalysisContext = { declarations: [{ id: "z", requirements: complete("q") }], profile: profile([], ["q"]) };

    const first = analyzeAndRecord(build());
    expect(analyzeAndRecord(build())).toStrictEqual(first);
    analyzeAndRecord(other);
    expect(analyzeAndRecord(build())).toStrictEqual(first);
  });

  describe("span semantics (C2, P4)", () => {
    const cited = (s: Semantic.Span) =>
      analyzedOf(analyzeAndRecord({ declarations: [{ id: "a", provenance: s, requirements: complete("fs") }], profile: profile([], ["fs"]) })).diagnostics[0]?.location;

    it("carries zero-based and point spans unchanged", () => {
      expect(cited(span("f", 0, 3))).toEqual({ _tag: "Span", span: span("f", 0, 3) });
      expect(cited(span("f", 7, 7))).toEqual({ _tag: "Span", span: span("f", 7, 7) });
    });

    it("carries accepted finite negative, fractional and beyond-source offsets unchanged (D6)", () => {
      for (const s of [span("f", -3, -1), span("f", 0.5, 2.25), span("f", 0, 1e9)]) expect(cited(s)).toEqual({ _tag: "Span", span: s });
    });

    it("is half-open: { start: 0, end: 2 } covers the first two code units", () => {
      const text = "fs();";
      const s = span("f", 0, 2);

      expect(cited(s)).toEqual({ _tag: "Span", span: s });
      expect(text.slice(s.start, s.end)).toBe("fs");
    });

    it("counts UTF-16 code units, not scalar values or graphemes", () => {
      const text = 'const e = "😀"; fs();';
      const start = text.indexOf("fs()");
      const s = span("app.ts", start, start + 4);
      const outcome = analyzedOf(analyzeAndRecord({
        declarations: [{ id: "a", requirements: complete({ capability: "fs", provenance: s }) }],
        profile: profile([], ["fs"]),
      }));

      expect(outcome.diagnostics[0]?.related).toEqual([{ span: s, label: "requirement declared here" }]);
      expect(text.slice(s.start, s.end)).toBe("fs()");
      expect([...text.slice(0, s.start)].length).toBe(s.start - 1);
    });
  });

  describe("rendering is the consumer's (DoD 7)", () => {
    // Throwaway test renderers, not deliverables.
    const plainText = (d: Semantic.Diagnostic) => d.location._tag === "Span"
      ? `${d.location.span.source}:${d.location.span.start}-${d.location.span.end} ${d.severity} ${d.code}`
      : `${d.subject} (no source span) ${d.severity} ${d.code}`;
    const structured = (ds: ReadonlyArray<Semantic.Diagnostic>) =>
      ds.map((d) => ({ code: d.code, severity: d.severity, subject: d.subject, where: d.location._tag === "Span" ? d.location.span : null }));

    it("two renderers render the same diagnostics without altering them", () => {
      const diagnostics = [
        ...matrix(["target-compatibility"]).diagnostics,
        ...analyzedOf(analyzeAndRecord({ declarations: [{ id: "u" }], profile: profile(), require: ["target-compatibility"] })).diagnostics,
      ];
      const before = structuredClone(diagnostics);

      expect(diagnostics.map(plainText)).toHaveLength(4);
      expect(structured(diagnostics)).toHaveLength(4);
      expect(plainText(diagnostics[3] as Semantic.Diagnostic)).toBe("u (no source span) warning nexus-opaque-operation");
      expect(diagnostics).toStrictEqual(before);
    });
  });

  // Runs last in this file: every outcome recorded above.
  it("every outcome produced in this file survives a JSON round trip unchanged", () => {
    expect(recorded.length).toBeGreaterThan(50);
    for (const outcome of recorded) expect(JSON.parse(JSON.stringify(outcome))).toStrictEqual(outcome);
  });
});
