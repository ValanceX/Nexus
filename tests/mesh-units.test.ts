// The adapter's pass-through for units (a component's state for one occurrence): it hands the host's unit states to the runtime and the intent to the binding, and keeps nothing (M2).
import { compile } from "@valancex/mesh-compiler";
import * as MeshRuntime from "@valancex/mesh-runtime";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

const { Mesh } = Nexus;

// The units need a runtime that has them (`@valancex/mesh-runtime` 0.15); an older one has no `raise`.
const supported = typeof (MeshRuntime as { readonly raise?: unknown }).raise === "function";

const model = JSON.stringify({
  version: 1,
  types: {},
  components: {
    box: { props: {}, events: {}, commands: {}, scope: {} },
    text: { props: {}, events: {}, commands: {}, scope: {} },
    button: { props: {}, events: { click: {} }, commands: {}, scope: {} },
    "mesh-if": { props: { when: { type: { kind: "boolean" }, required: true } }, events: {}, commands: {}, scope: {} },
    disclosure: {
      props: { label: { type: { kind: "string" }, required: true } },
      events: {},
      commands: {},
      scope: { label: { kind: "string" } },
      unit: { state: { open: { type: { kind: "boolean" }, default: false } }, commands: { toggle: { parameters: [] } } },
    },
    tabs: {
      props: {},
      events: { change: { payload: { kind: "number" } } },
      commands: {},
      scope: {},
      unit: { state: {}, commands: {} },
    },
    page: { props: {}, events: {}, commands: { chose: { parameters: [{ name: "n", type: { kind: "number" } }] } }, scope: { who: { kind: "string" } } },
  },
});
const sources = {
  page: "<box><disclosure label={who} /><tabs on.change={chose($event)} /></box>",
  disclosure: "<box><button on.click={toggle()}>{label}</button>{#if open}<text>open {label}</text>{/if}</box>",
  tabs: "<box><text>tabs</text></box>",
};

const templateOf = async (component: keyof typeof sources): Promise<string> => {
  const result = await compile({ source: sources[component], path: `${component}.mprx`, model: { manifest: model, path: "components.json", component } });

  if (result.template === undefined) {
    throw new Error(JSON.stringify(result.diagnostics));
  }

  return JSON.stringify(result.template);
};

const texts = (render: { readonly tree: { readonly root: unknown } }): ReadonlyArray<string> => {
  const found: Array<string> = [];
  const walk = (node: { readonly type?: string; readonly text?: string; readonly children?: ReadonlyArray<unknown> }): void => {
    if (node.type === "text") found.push(node.text!);
    node.children?.forEach((child) => walk(child as never));
  };

  walk(render.tree.root as never);

  return found;
};

describe.skipIf(!supported)("units through the adapter", () => {
  it("renders and updates with the state the host holds, lists the occurrences, and keeps nothing", async () => {
    const program: Nexus.Mesh.Program = { root: "page", templates: [await templateOf("page"), await templateOf("disclosure"), await templateOf("tabs")], model };
    const plain = await Effect.runPromise(Mesh.render(program, { who: "w" }));
    const [disclosure] = plain.instances;

    expect(texts(plain)).toEqual(["w", "tabs"]);
    expect(disclosure?.component).toBe("disclosure");

    const opened = await Effect.runPromise(Mesh.render(program, { who: "w" }, { [disclosure!.instance]: { open: true } }));

    expect(texts(opened)).toEqual(["w", "open w", "tabs"]);

    const closed = await Effect.runPromise(Mesh.update(opened, { who: "w" }, {}));

    expect(texts(closed.render)).toEqual(["w", "tabs"]);
    expect(closed.patches.patches.length).toBeGreaterThan(0);
  });

  it("gives a binding the intent, with the occurrence a unit command is for", async () => {
    const program: Nexus.Mesh.Program = { root: "page", templates: [await templateOf("page"), await templateOf("disclosure"), await templateOf("tabs")], model };
    const render = await Effect.runPromise(Mesh.render(program, { who: "w" }));
    const handler = (render.tree.root as { readonly children: ReadonlyArray<{ readonly children: ReadonlyArray<{ readonly events: Record<string, string> }> }> }).children[0]!.children[0]!.events["click"]!;
    const seen: Array<unknown> = [];
    const host = Mesh.host({
      program,
      scope: { value: Effect.succeed({ who: "w" }), changes: Stream.empty, values: Stream.empty },
      commands: { "disclosure/toggle": (_args, intent) => Effect.sync(() => void seen.push(intent.instance)) },
    });

    await Effect.runPromise(host.dispatch(render, handler));
    expect(seen).toEqual([render.instances[0]!.instance]);
  });

  it("reads the host's unit states each time it renders, and a host without them renders with the defaults", async () => {
    const program: Nexus.Mesh.Program = { root: "page", templates: [await templateOf("page"), await templateOf("disclosure"), await templateOf("tabs")], model };
    const first = await Effect.runPromise(Mesh.render(program, { who: "w" }));
    const key = first.instances[0]!.instance;
    const scope = { value: Effect.succeed({ who: "w" }), changes: Stream.empty, values: Stream.empty };
    const withUnits = await Effect.runPromise(Mesh.host({ program, scope, commands: {}, units: Effect.succeed({ [key]: { open: true } }) }).render);
    const without = await Effect.runPromise(Mesh.host({ program, scope, commands: {} }).render);

    expect(texts(withUnits)).toEqual(["w", "open w", "tabs"]);
    expect(texts(without)).toEqual(["w", "tabs"]);
  });

  it("raises an event of an occurrence to the handler its caller bound, or to none", async () => {
    const program: Nexus.Mesh.Program = { root: "page", templates: [await templateOf("page"), await templateOf("disclosure"), await templateOf("tabs")], model };
    const render = await Effect.runPromise(Mesh.render(program, { who: "w" }));
    const tabs = render.instances.find((each) => each.component === "tabs")!;
    const intent = await Effect.runPromise(Mesh.raise(render, tabs.instance, "change", 3));

    expect(intent?.command.name).toBe("chose");
    expect(intent?.arguments).toEqual([{ value: 3 }]);
    await expect(Effect.runPromise(Mesh.raise(render, "k-nowhere", "change", 3))).rejects.toBeDefined();
  });
});
