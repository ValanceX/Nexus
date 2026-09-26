// v0.5 D29: removing every executable primitive must not prevent building and
// analyzing. Each mock factory runs only if its module is imported, and then
// fails the import, so this file proves the semantic module reaches none of them.
import { describe, expect, it, vi } from "vitest";

vi.mock("effect", () => { throw new Error("effect was imported"); });
vi.mock("@valancex/mesh-runtime", () => { throw new Error("mesh-runtime was imported"); });
vi.mock("../src/application/index.js", () => { throw new Error("application was imported"); });
vi.mock("../src/runtime/index.js", () => { throw new Error("runtime was imported"); });
vi.mock("../src/service/index.js", () => { throw new Error("service was imported"); });
vi.mock("../src/state/index.js", () => { throw new Error("state was imported"); });
vi.mock("../src/selector/index.js", () => { throw new Error("selector was imported"); });
vi.mock("../src/command/index.js", () => { throw new Error("command was imported"); });
vi.mock("../src/capability/index.js", () => { throw new Error("capability was imported"); });
vi.mock("../src/resource/index.js", () => { throw new Error("resource was imported"); });
vi.mock("../src/event/index.js", () => { throw new Error("event was imported"); });
vi.mock("../src/mesh/index.js", () => { throw new Error("mesh was imported"); });

import * as Semantic from "../src/semantic/index.js";

describe("Semantic: no primitives (D29, I20)", () => {
  it("builds and analyzes a context with data flow, with every primitive unimportable", () => {
    const context: Semantic.AnalysisContext = {
      values: [{ id: "cart" }],
      declarations: [
        { id: "addItem", requirements: { completeness: "complete", capabilities: [{ capability: "fs" }] }, inputs: { completeness: "complete", references: [] }, outputs: { completeness: "complete", references: [{ value: "cart" }] } },
        { id: "checkout", inputs: { completeness: "complete", references: [{ value: "cart" }] } },
      ],
      profile: { name: "web", provided: ["fs"], notProvided: [] },
    };

    expect(Semantic.build(context)._tag).toBe("Built");
    expect(Semantic.analyze(context)._tag).toBe("Analyzed");
  });

  it("control: importing a primitive does fail in this file", async () => {
    await expect(import("../src/command/index.js")).rejects.toThrow();
  });
});
