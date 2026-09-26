// v0.5: Semantic.build and the semantic IR (outline C8–C11, D17–D23, D26).
import { describe, expect, it } from "vitest";

import * as Semantic from "../src/semantic/index.js";

// Every outcome built in this file goes through this helper, so the last test
// can check that each one survives a JSON round trip.
const recorded: Array<Semantic.BuildOutcome> = [];
const buildAndRecord = (context: Semantic.AnalysisContext): Semantic.BuildOutcome => {
  const outcome = Semantic.build(context);
  recorded.push(outcome);
  return outcome;
};

// Test fixtures only: these ids are not a vocabulary (v0.4 plan P9).
const span = (source: string, start: number, end: number): Semantic.Span => ({ source, start, end });
const profile = (): Semantic.TargetProfile => ({ name: "p", provided: [], notProvided: [] });
const refs = (values: ReadonlyArray<string | Semantic.ValueReference>): ReadonlyArray<Semantic.ValueReference> =>
  values.map((v) => typeof v === "string" ? { value: v } : v);
const complete = (...values: ReadonlyArray<string | Semantic.ValueReference>): Semantic.DataFlow => ({ completeness: "complete", references: refs(values) });
const partial = (...values: ReadonlyArray<string | Semantic.ValueReference>): Semantic.DataFlow => ({ completeness: "partial", references: refs(values) });
const values = (...ids: ReadonlyArray<string>): ReadonlyArray<Semantic.ValueDeclaration> => ids.map((id) => ({ id }));

const builtOf = (outcome: Semantic.BuildOutcome): Semantic.Built => {
  if (outcome._tag !== "Built") throw new Error(`expected Built, got ${JSON.stringify(outcome)}`);
  return outcome;
};
const issuesOf = (outcome: Semantic.BuildOutcome) => {
  if (outcome._tag !== "Rejected") throw new Error(`expected Rejected, got ${outcome._tag}`);
  return outcome.issues;
};
const operationOf = (built: Semantic.Built, id: string): Semantic.BuiltOperation => {
  const operation = built.operations.find((o) => o.id === id);
  if (operation === undefined) throw new Error(`no operation ${id}`);
  return operation;
};
const valueOf = (built: Semantic.Built, id: string): Semantic.BuiltValue => {
  const value = built.values.find((v) => v.id === id);
  if (value === undefined) throw new Error(`no value ${id}`);
  return value;
};

describe("Semantic.build: the three states of a data-flow fact (C8, C10)", () => {
  it("absent inputs and outputs are Unknown, with no other field", () => {
    const a = operationOf(builtOf(buildAndRecord({ declarations: [{ id: "a" }], profile: profile() })), "a");

    expect(a.inputs).toStrictEqual({ _tag: "Unknown" });
    expect(a.outputs).toStrictEqual({ _tag: "Unknown" });
  });

  it("a complete fact with no references is Declared complete-empty", () => {
    const a = operationOf(builtOf(buildAndRecord({ declarations: [{ id: "a", inputs: complete(), outputs: complete() }], profile: profile() })), "a");

    expect(a.inputs).toStrictEqual({ _tag: "Declared", completeness: "complete", values: [], references: [] });
    expect(a.outputs).toStrictEqual({ _tag: "Declared", completeness: "complete", values: [], references: [] });
  });

  it("a partial fact with no references stays Declared partial-empty, never Unknown or complete-empty", () => {
    const a = operationOf(builtOf(buildAndRecord({ declarations: [{ id: "a", inputs: partial(), outputs: partial() }], profile: profile() })), "a");

    expect(a.inputs).toStrictEqual({ _tag: "Declared", completeness: "partial", values: [], references: [] });
    expect(a.outputs).toStrictEqual({ _tag: "Declared", completeness: "partial", values: [], references: [] });
  });

  it("requirements keep v0.4's two states: Unknown, or Declared as given", () => {
    const built = builtOf(buildAndRecord({
      declarations: [{ id: "a" }, { id: "b", requirements: { completeness: "partial", capabilities: [{ capability: "fs" }, { capability: "fs" }] } }],
      profile: profile(),
    }));

    expect(operationOf(built, "a").requirements).toStrictEqual({ _tag: "Unknown" });
    expect(operationOf(built, "b").requirements).toStrictEqual({
      _tag: "Declared", completeness: "partial",
      capabilities: [{ capability: "fs", provenance: { _tag: "Unlocated" } }, { capability: "fs", provenance: { _tag: "Unlocated" } }],
    });
  });
});

describe("Semantic.build: values and references (C8, C9; I24)", () => {
  it("an absent values list builds exactly like an empty one", () => {
    const context: Semantic.AnalysisContext = { declarations: [{ id: "a", inputs: complete() }], profile: profile() };

    expect(buildAndRecord(context)).toStrictEqual(buildAndRecord({ ...context, values: [] }));
    expect(builtOf(buildAndRecord(context)).values).toEqual([]);
  });

  it("a missing value identity is rejected", () => {
    expect(issuesOf(buildAndRecord({ values: [{ id: "" }], declarations: [], profile: profile() })))
      .toStrictEqual([{ reason: "missing-identity", path: ["values", 0, "id"] }]);
  });

  it("a duplicate value identity is reported at every later occurrence", () => {
    expect(issuesOf(buildAndRecord({ values: values("v", "v", "v"), declarations: [], profile: profile() }))).toStrictEqual([
      { reason: "duplicate-identity", path: ["values", 1, "id"] },
      { reason: "duplicate-identity", path: ["values", 2, "id"] },
    ]);
  });

  it("an unresolved reference is rejected at its path, including the empty identity", () => {
    const outcome = buildAndRecord({
      values: values("cart"),
      declarations: [{ id: "a", inputs: complete("cart", "nope", ""), outputs: partial("x") }],
      profile: profile(),
    });

    expect(issuesOf(outcome)).toStrictEqual([
      { reason: "unresolved-reference", path: ["declarations", 0, "inputs", "references", 1, "value"] },
      { reason: "unresolved-reference", path: ["declarations", 0, "inputs", "references", 2, "value"] },
      { reason: "unresolved-reference", path: ["declarations", 0, "outputs", "references", 0, "value"] },
    ]);
  });

  it("a reference to an operation or capability identity is unresolved (separate identity spaces)", () => {
    const outcome = buildAndRecord({
      declarations: [{ id: "a", requirements: { completeness: "complete", capabilities: [{ capability: "fs" }] }, inputs: complete("a", "fs") }],
      profile: profile(),
    });

    expect(issuesOf(outcome)).toStrictEqual([
      { reason: "unresolved-reference", path: ["declarations", 0, "inputs", "references", 0, "value"] },
      { reason: "unresolved-reference", path: ["declarations", 0, "inputs", "references", 1, "value"] },
    ]);
  });

  it("a reference to a value rejected for a missing identity is unresolved", () => {
    expect(issuesOf(buildAndRecord({ values: [{ id: "" }], declarations: [{ id: "a", inputs: complete("") }], profile: profile() }))).toStrictEqual([
      { reason: "missing-identity", path: ["values", 0, "id"] },
      { reason: "unresolved-reference", path: ["declarations", 0, "inputs", "references", 0, "value"] },
    ]);
  });

  it("a reference to a duplicated value resolves; only the duplicate is reported", () => {
    expect(issuesOf(buildAndRecord({ values: values("v", "v"), declarations: [{ id: "a", inputs: complete("v") }], profile: profile() })))
      .toStrictEqual([{ reason: "duplicate-identity", path: ["values", 1, "id"] }]);
  });

  it("an invalid span on a value or a reference is rejected", () => {
    const outcome = buildAndRecord({
      values: [{ id: "cart", provenance: span("", 0, 1) }],
      declarations: [{ id: "a", outputs: complete({ value: "cart", provenance: span("f", 2, 1) }) }],
      profile: profile(),
    });

    expect(issuesOf(outcome)).toStrictEqual([
      { reason: "invalid-span", path: ["values", 0, "provenance"] },
      { reason: "invalid-span", path: ["declarations", 0, "outputs", "references", 0, "provenance"] },
    ]);
  });

  it("issues follow the order: values, then each declaration (v0.4 fields, inputs, outputs), then the profile", () => {
    const outcome = buildAndRecord({
      values: [{ id: "" }],
      declarations: [{ id: "", inputs: complete("x"), outputs: complete("y") }],
      profile: { name: "p", provided: [""], notProvided: [] },
    });

    expect(issuesOf(outcome)).toStrictEqual([
      { reason: "missing-identity", path: ["values", 0, "id"] },
      { reason: "missing-identity", path: ["declarations", 0, "id"] },
      { reason: "unresolved-reference", path: ["declarations", 0, "inputs", "references", 0, "value"] },
      { reason: "unresolved-reference", path: ["declarations", 0, "outputs", "references", 0, "value"] },
      { reason: "empty-capability", path: ["profile", "provided", 0] },
    ]);
  });

  it("a value may share an identity with an operation and a capability", () => {
    const built = builtOf(buildAndRecord({
      values: values("a", "fs"),
      declarations: [{ id: "a", requirements: { completeness: "complete", capabilities: [{ capability: "fs" }] }, inputs: complete("fs"), outputs: complete() }],
      profile: { name: "p", provided: ["fs"], notProvided: [] },
    }));

    expect(valueOf(built, "a").producers).toStrictEqual({ _tag: "Closed", members: [] });
    expect(valueOf(built, "a").consumers).toStrictEqual({ _tag: "Closed", members: [] });
    expect(valueOf(built, "fs").consumers).toStrictEqual({ _tag: "Closed", members: ["a"] });
  });

  it("names create nothing (I14): a value named like an operation gains no relationship", () => {
    const built = builtOf(buildAndRecord({
      values: [{ id: "cart", name: "addToCart" }],
      declarations: [{ id: "addToCart", name: "cart", inputs: complete(), outputs: complete() }],
      profile: profile(),
    }));

    expect(valueOf(built, "cart").producers).toStrictEqual({ _tag: "Closed", members: [] });
    expect(valueOf(built, "cart").consumers).toStrictEqual({ _tag: "Closed", members: [] });
  });
});

describe("Semantic.build: provenance and the carried profile (C8, C10, D22)", () => {
  it("keeps value, operation and every reference occurrence's provenance distinct", () => {
    const built = builtOf(buildAndRecord({
      values: [{ id: "cart", name: "Cart", provenance: span("v.ts", 0, 4) }],
      declarations: [{
        id: "add", provenance: span("a.ts", 0, 9),
        inputs: complete({ value: "cart", provenance: span("a.ts", 1, 2) }, { value: "cart", provenance: span("a.ts", 3, 4) }, "cart"),
      }],
      profile: profile(),
    }));

    expect(operationOf(built, "add")).toMatchObject({ name: { _tag: "Unnamed" }, provenance: { _tag: "Span", span: span("a.ts", 0, 9) } });
    expect(operationOf(built, "add").inputs).toStrictEqual({
      _tag: "Declared", completeness: "complete", values: ["cart"],
      references: [
        { value: "cart", provenance: { _tag: "Span", span: span("a.ts", 1, 2) } },
        { value: "cart", provenance: { _tag: "Span", span: span("a.ts", 3, 4) } },
        { value: "cart", provenance: { _tag: "Unlocated" } },
      ],
    });
    expect(valueOf(built, "cart")).toMatchObject({ name: { _tag: "Named", name: "Cart" }, provenance: { _tag: "Span", span: span("v.ts", 0, 4) } });
  });

  it("distinct values keep first-occurrence order", () => {
    const built = builtOf(buildAndRecord({ values: values("x", "y"), declarations: [{ id: "a", outputs: partial("y", "x", "y") }], profile: profile() }));

    expect(operationOf(built, "a").outputs).toMatchObject({ values: ["y", "x"] });
  });

  it("an empty name is present, not absent", () => {
    expect(valueOf(builtOf(buildAndRecord({ values: [{ id: "v", name: "" }], declarations: [], profile: profile() })), "v").name)
      .toStrictEqual({ _tag: "Named", name: "" });
  });

  it("carries the profile and the required facts (D22)", () => {
    const built = builtOf(buildAndRecord({
      declarations: [],
      profile: { name: "web", provenance: span("p.json", 0, 1), provided: ["fs", "fs"], notProvided: ["net"] },
      require: ["target-compatibility", "target-compatibility"],
    }));

    expect(built.profile).toStrictEqual({ name: "web", provenance: { _tag: "Span", span: span("p.json", 0, 1) }, provided: ["fs", "fs"], notProvided: ["net"] });
    expect(built.required).toStrictEqual(["target-compatibility"]);
    expect(builtOf(buildAndRecord({ declarations: [], profile: profile() })).required).toStrictEqual([]);
  });

  it("output spans are fresh { source, start, end }, without forged extras", () => {
    const forged = { ...span("a.ts", 1, 2), label: "x" };
    const built = builtOf(buildAndRecord({ values: [{ id: "v", provenance: forged }], declarations: [], profile: profile() }));
    const provenance = valueOf(built, "v").provenance;

    expect(provenance).toStrictEqual({ _tag: "Span", span: span("a.ts", 1, 2) });
    if (provenance._tag === "Span") expect(provenance.span).not.toBe(forged);
  });
});

// Test-only: may-flow is derived from membership and never stored (C11).
const mayFlow = (built: Semantic.Built) => built.values.flatMap((v) =>
  v.producers.members.flatMap((p) => v.consumers.members.map((c) => [p, v.id, c] as const)));

describe("Semantic.build: producer and consumer openness (C11, I23)", () => {
  it("both sides close when every operation's facts are complete, including closed-empty", () => {
    const built = builtOf(buildAndRecord({
      values: values("cart", "note"),
      declarations: [{ id: "add", inputs: complete(), outputs: complete("cart") }, { id: "checkout", inputs: complete("cart"), outputs: complete() }],
      profile: profile(),
    }));

    expect(valueOf(built, "cart")).toMatchObject({ producers: { _tag: "Closed", members: ["add"] }, consumers: { _tag: "Closed", members: ["checkout"] } });
    expect(valueOf(built, "note").producers).toStrictEqual({ _tag: "Closed", members: [] });
    expect(valueOf(built, "note").consumers).toStrictEqual({ _tag: "Closed", members: [] });
  });

  it("closed-empty and open-empty are different tags", () => {
    const built = builtOf(buildAndRecord({ values: values("note"), declarations: [{ id: "log" }], profile: profile() }));

    expect(valueOf(built, "note").producers).toStrictEqual({ _tag: "Open", members: [], openedBy: ["log"] });
    expect(valueOf(built, "note").producers).not.toStrictEqual({ _tag: "Closed", members: [] });
  });

  it("openedBy is exactly the unknown and partial operations, in declaration order, and every value shares it", () => {
    const built = builtOf(buildAndRecord({
      values: values("x", "y"),
      declarations: [{ id: "a" }, { id: "b", outputs: complete("x") }, { id: "c", outputs: partial("x") }, { id: "d", outputs: partial() }],
      profile: profile(),
    }));

    expect(valueOf(built, "x").producers).toStrictEqual({ _tag: "Open", members: ["b", "c"], openedBy: ["a", "c", "d"] });
    expect(valueOf(built, "y").producers).toStrictEqual({ _tag: "Open", members: [], openedBy: ["a", "c", "d"] });
    expect(valueOf(built, "x").consumers).toStrictEqual({ _tag: "Open", members: [], openedBy: ["a", "b", "c", "d"] });
  });

  it("partial-empty opens its side exactly as unknown does, and stays Declared", () => {
    const withPartial = builtOf(buildAndRecord({ values: values("v"), declarations: [{ id: "a", outputs: complete("v") }, { id: "b", outputs: partial() }], profile: profile() }));
    const withUnknown = builtOf(buildAndRecord({ values: values("v"), declarations: [{ id: "a", outputs: complete("v") }, { id: "b" }], profile: profile() }));

    expect(valueOf(withPartial, "v").producers).toStrictEqual({ _tag: "Open", members: ["a"], openedBy: ["b"] });
    expect(valueOf(withUnknown, "v").producers).toStrictEqual(valueOf(withPartial, "v").producers);
    expect(operationOf(withPartial, "b").outputs._tag).toBe("Declared");
    expect(operationOf(withUnknown, "b").outputs._tag).toBe("Unknown");
  });

  it("each side's openness ignores the other side", () => {
    const built = builtOf(buildAndRecord({ values: values("v"), declarations: [{ id: "a", outputs: complete("v") }], profile: profile() }));

    expect(valueOf(built, "v").producers).toStrictEqual({ _tag: "Closed", members: ["a"] });
    expect(valueOf(built, "v").consumers).toStrictEqual({ _tag: "Open", members: [], openedBy: ["a"] });
  });

  it("no operations: every set is closed and empty", () => {
    const built = builtOf(buildAndRecord({ values: values("v"), declarations: [], profile: profile() }));

    expect(valueOf(built, "v")).toMatchObject({ producers: { _tag: "Closed", members: [] }, consumers: { _tag: "Closed", members: [] } });
  });

  it("an operation appears once in members, however often it references the value", () => {
    const built = builtOf(buildAndRecord({ values: values("v"), declarations: [{ id: "a", outputs: complete("v", "v") }], profile: profile() }));

    expect(valueOf(built, "v").producers).toStrictEqual({ _tag: "Closed", members: ["a"] });
  });

  it("creates no synthetic or wildcard value for unknown facts", () => {
    const built = builtOf(buildAndRecord({ values: values("v"), declarations: [{ id: "a" }, { id: "b", inputs: partial() }], profile: profile() }));

    expect(built.values.map((v) => v.id)).toEqual(["v"]);
  });
});

describe("Semantic.build: may-flow (C11; I21, I22)", () => {
  it("the cart: three producers give three unordered edges into checkout", () => {
    const built = builtOf(buildAndRecord({
      values: values("cart"),
      declarations: [
        { id: "addItem", inputs: complete(), outputs: complete("cart") },
        { id: "removeItem", inputs: complete(), outputs: complete("cart") },
        { id: "clear", inputs: complete(), outputs: complete("cart") },
        { id: "checkout", inputs: complete("cart"), outputs: complete() },
      ],
      profile: profile(),
    }));

    expect(mayFlow(built)).toEqual([["addItem", "cart", "checkout"], ["removeItem", "cart", "checkout"], ["clear", "cart", "checkout"]]);
    expect(valueOf(built, "cart").producers._tag).toBe("Closed");
  });

  it("edges are exactly producers × consumers", () => {
    const built = builtOf(buildAndRecord({
      values: values("v"),
      declarations: [
        { id: "p1", outputs: complete("v") }, { id: "p2", outputs: complete("v") },
        { id: "c1", inputs: complete("v") }, { id: "c2", inputs: complete("v") }, { id: "c3", inputs: partial("v") },
      ],
      profile: profile(),
    }));

    expect(mayFlow(built)).toEqual([
      ["p1", "v", "c1"], ["p1", "v", "c2"], ["p1", "v", "c3"],
      ["p2", "v", "c1"], ["p2", "v", "c2"], ["p2", "v", "c3"],
    ]);
  });

  it("an operation that consumes and produces a value has a self edge", () => {
    const built = builtOf(buildAndRecord({ values: values("n"), declarations: [{ id: "inc", inputs: complete("n"), outputs: complete("n") }], profile: profile() }));

    expect(mayFlow(built)).toEqual([["inc", "n", "inc"]]);
  });

  it("stores no edge list: Built, its operations and its values have exactly their documented fields", () => {
    const built = builtOf(buildAndRecord({ values: values("n"), declarations: [{ id: "inc", inputs: complete("n"), outputs: complete("n") }], profile: profile() }));

    expect(Object.keys(built)).toEqual(["_tag", "profile", "required", "operations", "values"]);
    expect(Object.keys(operationOf(built, "inc"))).toEqual(["id", "name", "provenance", "requirements", "inputs", "outputs"]);
    expect(Object.keys(valueOf(built, "n"))).toEqual(["id", "name", "provenance", "producers", "consumers"]);
  });
});

describe("Semantic.build: pure, deterministic, plain (C10, D26; I11)", () => {
  const dataFlowContext = (): Semantic.AnalysisContext => ({
    values: [{ id: "cart", name: "Cart", provenance: span("v.ts", 0, 4) }, { id: "user" }],
    declarations: [
      { id: "add", provenance: span("a.ts", 0, 9), requirements: { completeness: "complete", capabilities: [{ capability: "fs" }] }, inputs: complete("user"), outputs: complete({ value: "cart", provenance: span("a.ts", 1, 2) }) },
      { id: "checkout", inputs: partial("cart") },
    ],
    profile: { name: "web", provided: ["fs"], notProvided: [] },
    require: ["target-compatibility"],
  });

  it("reads only modeled fields, and never enumerates or writes", () => {
    const modeled = new Set([
      "values", "declarations", "profile", "require",
      "id", "name", "provenance", "requirements", "inputs", "outputs",
      "completeness", "capabilities", "capability", "references", "value",
      "provided", "notProvided", "source", "start", "end", "length",
    ]);
    const events: Array<string> = [];
    const wrap = <T>(value: T): T => {
      if (typeof value !== "object" || value === null) return value;
      const wrapped = Array.isArray(value) ? value.map(wrap) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wrap(v)]));
      return new Proxy(wrapped, {
        get: (target, key, receiver) => { events.push(`get:${String(key)}`); return Reflect.get(target, key, receiver); },
        has: (target, key) => { events.push(`has:${String(key)}`); return Reflect.has(target, key); },
        ownKeys: (target) => { events.push("ownKeys"); return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor: (target, key) => { events.push(`descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(target, key); },
        set: (target, key, v) => { events.push(`set:${String(key)}`); return Reflect.set(target, key, v); },
        defineProperty: (target, key, d) => { events.push(`define:${String(key)}`); return Reflect.defineProperty(target, key, d); },
        deleteProperty: (target, key) => { events.push(`delete:${String(key)}`); return Reflect.deleteProperty(target, key); },
      }) as T;
    };

    expect(buildAndRecord(wrap(dataFlowContext()))._tag).toBe("Built");
    expect(events.filter((e) => !e.startsWith("get:") || (!modeled.has(e.slice(4)) && !/^\d+$/.test(e.slice(4))))).toEqual([]);
  });

  it("never invokes a value it is given", () => {
    let calls = 0;
    const trap = () => { calls++; throw new Error("called"); };
    const armed = <T extends object>(value: T): T => Object.assign(value, { then: trap, toJSON: trap, valueOf: trap, toString: trap });
    const input = armed({
      values: [armed({ id: "cart" })],
      declarations: [armed({ id: "a", inputs: armed({ completeness: "complete" as const, references: [armed({ value: "cart" })] }), outputs: armed({ completeness: "partial" as const, references: [] }) })],
      profile: armed({ name: "p", provided: [], notProvided: [] }),
    });

    expect(buildAndRecord(input)._tag).toBe("Built");
    expect(Semantic.analyze(input)._tag).toBe("Analyzed");
    expect(calls).toBe(0);
  });

  it("never mutates its input: a deep-frozen context builds, and is unchanged", () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === "object" && value !== null) {
        for (const v of Object.values(value)) deepFreeze(v);
        Object.freeze(value);
      }
      return value;
    };
    const input = deepFreeze(dataFlowContext());
    const before = structuredClone(input);

    expect(buildAndRecord(input)._tag).toBe("Built");
    expect(input).toStrictEqual(before);
  });

  it("the same context gives the same Built, and nothing is kept between calls", () => {
    const first = buildAndRecord(dataFlowContext());
    buildAndRecord({ values: values("z"), declarations: [{ id: "z", outputs: complete("z") }], profile: profile() });

    expect(buildAndRecord(dataFlowContext())).toStrictEqual(first);
  });

  it("mutating the input after build doesn't change Built", () => {
    type Mutable = { values: Array<{ id: string }>; declarations: Array<{ id: string; outputs: { references: Array<{ value: string }> } }> };
    const input = structuredClone(dataFlowContext());
    const built = buildAndRecord(input);
    const before = structuredClone(built);
    const mutable = input as unknown as Mutable;

    mutable.values[0]!.id = "changed";
    mutable.declarations[0]!.id = "changed";
    mutable.declarations[0]!.outputs.references.push({ value: "user" });

    expect(built).toStrictEqual(before);
  });

  it("is synchronous: the result is a plain outcome, not a thenable", () => {
    const outcome = buildAndRecord(dataFlowContext());

    expect("then" in outcome).toBe(false);
  });

  it("never throws on malformed data-flow input", () => {
    const garbage = {
      values: [{ id: undefined }, { id: 3 }, { id: "v", provenance: { source: "", start: NaN, end: -0 } }],
      declarations: [{ id: "a", inputs: { completeness: "complete", references: [{ value: undefined }, { value: {} }] }, outputs: { completeness: "partial", references: [] } }],
      profile: { name: "p", provided: [], notProvided: [] },
    } as unknown as Semantic.AnalysisContext;

    expect(() => buildAndRecord(garbage)).not.toThrow();
    expect(buildAndRecord(garbage)._tag).toBe("Rejected");
  });
});

describe("Semantic.build: plain data (C10)", () => {
  // Keep this block last: it checks every outcome built above.
  it("every recorded outcome survives a JSON round trip", () => {
    expect(recorded.length).toBeGreaterThan(20);
    for (const outcome of recorded) expect(JSON.parse(JSON.stringify(outcome))).toStrictEqual(outcome);
  });
});
