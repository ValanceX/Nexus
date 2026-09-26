// v0.5 I27: for every v0.4-shaped context, Semantic.analyze returns exactly what
// v0.4 returned. The oracle is the released v0.4 module itself
// (tests/reference/semantic-v0.4.ts, a verbatim copy of v0.4.0), not
// hand-written fixtures.
import { describe, expect, it } from "vitest";

import * as Semantic from "../src/semantic/index.js";
import * as Reference from "./reference/semantic-v0.4.js";

// A tiny seeded PRNG (mulberry32), so the corpus is identical on every run.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Next = () => number;
const pick = <T>(next: Next, items: ReadonlyArray<T>): T => items[Math.floor(next() * items.length)] as T;
const some = <T>(next: Next, max: number, make: (i: number) => T): Array<T> =>
  Array.from({ length: Math.floor(next() * (max + 1)) }, (_, i) => make(i));

// Test fixtures only: these ids are not a vocabulary (v0.4 plan P9).
const validSpans: ReadonlyArray<Semantic.Span> = [
  { source: "app.ts", start: 0, end: 4 }, { source: "app.ts", start: 3, end: 3 }, { source: "lib.ts", start: 0.5, end: 9 },
];
const invalidSpans: ReadonlyArray<Semantic.Span> = [
  { source: "", start: 0, end: 1 }, { source: "app.ts", start: 5, end: 2 }, { source: "app.ts", start: NaN, end: 1 }, { source: "app.ts", start: -0, end: 1 },
];
const capabilityIds = ["fs", "net", "gpu", "cam"];

// v0.4-shaped: no `values`, `inputs` or `outputs` anywhere. Mostly valid, with
// every D6 malformation reachable.
const v04Context = (next: Next): Semantic.AnalysisContext => {
  const span = () => next() < 0.9 ? pick(next, validSpans) : pick(next, invalidSpans);
  const capability = () => next() < 0.95 ? pick(next, capabilityIds) : "";
  const decided = () => capabilityIds.filter(() => next() < 0.3);

  return {
    declarations: some(next, 4, (i): Semantic.Declaration => ({
      id: next() < 0.9 ? `op${i}` : pick(next, ["", "op0"]),
      ...(next() < 0.3 ? { name: pick(next, ["Save", ""]) } : {}),
      ...(next() < 0.5 ? { provenance: span() } : {}),
      ...(next() < 0.75 ? {
        requirements: {
          completeness: pick(next, ["complete", "partial"] as const),
          capabilities: some(next, 3, () => ({ capability: capability(), ...(next() < 0.5 ? { provenance: span() } : {}) })),
        },
      } : {}),
    })),
    profile: {
      name: pick(next, ["browser", ""]),
      ...(next() < 0.5 ? { provenance: span() } : {}),
      provided: next() < 0.95 ? decided() : [...decided(), ""],
      notProvided: next() < 0.95 ? decided() : ["", ...decided()],
    },
    ...(next() < 0.66 ? { require: pick(next, [[], ["target-compatibility"]] as const) } : {}),
  };
};

const next = random(0x5eed);
const corpus: ReadonlyArray<Semantic.AnalysisContext> = Array.from({ length: 2000 }, () => v04Context(next));

describe("Semantic: v0.4 compatibility (I27, DoD 10)", () => {
  it("the corpus exercises every v0.4 outcome, verdict, code and rejection reason", () => {
    const seen = new Set<string>();
    for (const context of corpus) {
      const outcome = Reference.analyze(context);
      seen.add(outcome._tag);
      if (outcome._tag === "Rejected") {
        for (const issue of outcome.issues) seen.add(issue.reason);
      } else {
        for (const operation of outcome.operations) seen.add(operation.verdict._tag === "Undetermined" ? `Undetermined:${operation.verdict.cause}` : operation.verdict._tag);
        for (const diagnostic of outcome.diagnostics) seen.add(diagnostic.code);
      }
    }

    expect([...seen].sort()).toEqual([
      "Analyzed", "Rejected",
      "duplicate-identity", "missing-identity", "invalid-span", "empty-capability", "conflicting-decision",
      "Compatible", "Incompatible", "Undetermined:operation", "Undetermined:target",
      "nexus-incompatible-target-capability", "nexus-opaque-operation", "nexus-undetermined-target-capability",
    ].sort());
  });

  it("Semantic.analyze equals v0.4's analyze on every corpus context, including issue order", () => {
    for (const context of corpus) expect(Semantic.analyze(context)).toStrictEqual(Reference.analyze(context));
  });
});
