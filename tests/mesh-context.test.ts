// The adapter's pass-through for the context channel (MESH 0.18): values the manifest declares once (`context`) and a component reads only when it lists
// them (`uses`). The host holds them; the adapter hands them to the runtime beside the snapshot and keeps nothing (M2).
import { compile } from "@valancex/mesh-compiler";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

const { Mesh } = Nexus;

const model = JSON.stringify({
  version: 1,
  types: {},
  context: { theme: { kind: "enum", values: ["light", "dark"] } },
  components: {
    box: { props: {}, events: {}, commands: {}, scope: {} },
    text: { props: {}, events: {}, commands: {}, scope: {} },
    // The page does not read the theme and does not pass it: the badge, two levels down, lists it in `uses`.
    page: { props: {}, events: {}, commands: {}, scope: { who: { kind: "string" } } },
    card: { props: { who: { type: { kind: "string" }, required: true } }, events: {}, commands: {}, scope: { who: { kind: "string" } } },
    badge: { props: {}, events: {}, commands: {}, scope: {}, uses: ["theme"] },
  },
});
const sources = {
  page: "<box><card who={who} /></box>",
  card: "<box><text>{who}</text><badge /></box>",
  badge: "<text>{theme}</text>",
};

const program = async (): Promise<Nexus.Mesh.Program> => ({
  root: "page",
  model,
  templates: await Promise.all(
    (Object.keys(sources) as ReadonlyArray<keyof typeof sources>).map(async (component) => {
      const result = await compile({ source: sources[component], path: `${component}.mprx`, model: { manifest: model, path: "components.json", component } });

      if (result.template === undefined) {
        throw new Error(JSON.stringify(result.diagnostics));
      }

      return JSON.stringify(result.template);
    }),
  ),
});

const texts = (render: { readonly tree: { readonly root: unknown } }): ReadonlyArray<string> => {
  const found: Array<string> = [];
  const walk = (node: { readonly type?: string; readonly text?: string; readonly children?: ReadonlyArray<unknown> }): void => {
    if (node.type === "text") found.push(node.text!);
    node.children?.forEach((child) => walk(child as never));
  };

  walk(render.tree.root as never);

  return found;
};

describe("the context channel through the adapter", () => {
  it("renders with the context given, and an update with a new context changes only what reads it", async () => {
    const given = await program();
    const dark = await Effect.runPromise(Mesh.render(given, { who: "w" }, undefined, { theme: "dark" }));

    expect(texts(dark)).toEqual(["w", "dark"]);

    const light = await Effect.runPromise(Mesh.update(dark, { who: "w" }, undefined, { theme: "light" }));

    expect(texts(light.render)).toEqual(["w", "light"]);
    expect(light.patches.patches.length).toBeGreaterThan(0);

    // Without a context, the update keeps the previous render's.
    const kept = await Effect.runPromise(Mesh.update(light.render, { who: "v" }));

    expect(texts(kept.render)).toEqual(["v", "light"]);
  });

  it("a host reads the context it holds each time it renders, and a missing required value is MESH's diagnostic", async () => {
    const given = await program();
    let theme = "dark";
    const scope = { value: Effect.succeed({ who: "w" }), changes: Stream.empty, values: Stream.make({ who: "w" }, { who: "x" }) };
    const host = Mesh.host({ program: given, scope, commands: {}, context: Effect.sync(() => ({ theme })) });

    expect(texts(await Effect.runPromise(host.render))).toEqual(["w", "dark"]);
    theme = "light";
    expect([...(await Effect.runPromise(Stream.runCollect(host.values)))].map(texts)).toEqual([
      ["w", "light"],
      ["x", "light"],
    ]);

    const missing = await Effect.runPromise(Effect.flip(Mesh.host({ program: given, scope, commands: {} }).render));

    expect(missing.diagnostics.diagnostics[0]?.code).toBe("runtime-missing-value");
  });
});
