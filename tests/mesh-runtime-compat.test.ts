// The MESH runtime boundary: the application supplies the one MESH runtime NEXUS renders with.
// It is a peer dependency, not a dependency: a dependency under 0.x semver (`^0.8.0` excludes 0.9) gave an application on a
// newer MESH a second, private runtime inside `Mesh.host`, and a browser's `init()` reaches only one. The adapter calls
// `render` and `dispatch` and passes the render through.
import type { RenderNode } from "@valancex/mesh-runtime";

import { compile } from "@valancex/mesh-compiler";
import { Effect, Layer, Schema, Stream } from "effect";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { readonly dependencies: Record<string, string>; readonly peerDependencies: Record<string, string> };

describe("the MESH runtime boundary", () => {
  it("the runtime is the application's peer, not NEXUS's own dependency, and the development install is the only one", () => {
    const range = manifest.peerDependencies["@valancex/mesh-runtime"]!;
    const installed = (JSON.parse(readFileSync(createRequire(import.meta.url).resolve("@valancex/mesh-runtime/package.json"), "utf8")) as { version: string }).version;
    const [major, minor] = installed.split(".");

    // No private copy can be installed beside the application's.
    expect(manifest.dependencies["@valancex/mesh-runtime"]).toBeUndefined();
    // Each alternative is `^0.minor.patch`, which on a 0.x version admits only that minor (semver caret); the installed runtime is admitted.
    const alternatives = range.split(" || ");

    expect(alternatives.every((alternative) => /^\^0\.\d+\.\d+$/.test(alternative))).toBe(true);
    expect(alternatives.map((alternative) => alternative.slice(1).split(".")[1])).toContain(minor);
    expect(major).toBe("0");
    // One MESH runtime in the resolved graph (the lockfile's, not the store directory's, which keeps what was once installed).
    const locked = [...new Set([...readFileSync(new URL("pnpm-lock.yaml", root), "utf8").matchAll(/^ {2}'?(@valancex\/mesh-runtime@[^:'\s]+)'?:/gm)].map((match) => match[1]))];

    expect(locked).toEqual([`@valancex/mesh-runtime@${installed}`]);
  });

  it("a host passes through MESH 0.7's keyed repeat: the same item has the same key across reorder, insert and removal", async () => {
    const model = JSON.stringify({
      version: 1, types: {},
      components: {
        page: { props: {}, events: {}, commands: {}, scope: {} },
        row: { props: {}, events: {}, commands: {}, scope: {} },
        "mesh-each": { props: { items: { type: { kind: "list", element: { kind: "any" } }, required: true }, as: { type: { kind: "string" }, required: true }, key: { type: { kind: "any" }, required: true } }, events: {}, commands: {}, scope: {} },
        list: { props: {}, events: {}, commands: {}, scope: { ids: { kind: "list", element: { kind: "record", fields: { id: { type: { kind: "string" }, required: true } } } } } },
      },
    });
    const source = `<page><mesh-each items={ids} as="item" key={item.id}><row>{item.id}</row></mesh-each></page>`;
    const compiled = await compile({ source, path: "list.mprx", model: { manifest: model, path: "components.json", component: "list" } });

    if (compiled.template === undefined) {
      throw new Error(`list.mprx doesn't compile: ${JSON.stringify(compiled.diagnostics)}`);
    }

    const Ids = Schema.Struct({ ids: Schema.Array(Schema.Struct({ id: Schema.String })) });
    const keys = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const running = yield* Nexus.Application.start(Nexus.Application.define({ name: "keyed", runtime: Layer.empty }));
      const state = yield* Nexus.Application.createState(running, Ids, { ids: [{ id: "a" }, { id: "b" }, { id: "c" }] });
      const host = Nexus.Mesh.host({ program: { root: "list", templates: [JSON.stringify(compiled.template)], model }, scope: Nexus.Selector.define(state, (value) => value), commands: {} });
      const seen: Array<Record<string, string>> = [];
      const keyed = (tree: { readonly root: RenderNode }): Record<string, string> => Object.fromEntries((tree.root.children as ReadonlyArray<RenderNode>).map((child) => [(child.children[0] as unknown as { text: string }).text, child.key]));

      for (const ids of [["a", "b", "c"], ["c", "a", "b"], ["a", "c"], ["a", "c", "d"]]) {
        yield* state.update(() => Effect.succeed({ ids: ids.map((id) => ({ id })) }));
        seen.push(keyed((yield* host.render).tree));
      }

      expect(yield* Stream.runHead(host.values)).toBeDefined();

      return seen;
    })));

    // An item's key is its own, wherever it is rendered; a new item has a new key.
    const key = (step: number, id: string): string | undefined => keys[step]![id];

    expect(key(1, "a")).toBe(key(0, "a"));
    expect(key(1, "c")).toBe(key(0, "c"));
    expect(key(2, "a")).toBe(key(0, "a"));
    expect(key(3, "c")).toBe(key(0, "c"));
    expect(new Set(Object.values(keys[3]!)).size).toBe(3);
    expect(key(3, "d")).not.toBe(key(0, "a"));
  });
});
