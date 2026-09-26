// Spec tests 1–8: NEXUS driving MESH v0.5 end to end, against the published
// @valancex/mesh-runtime and MESH's own slice (tests/fixtures/mesh-slice).
import type { RenderNode, RenderTree } from "@valancex/mesh-runtime";
import type { StateHandle } from "../src/state/index.js";

import { compile } from "@valancex/mesh-compiler";
import { Cause, Chunk, Duration, Effect, Exit, Fiber, Layer, Option, Ref, Schedule, Schema, Scope, Stream } from "effect";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

const { Mesh } = Nexus;

// ---------------------------------------------------------------------------
// The fixture: compiled once, at "build time" (the only compiler use, M4).

const fixture = new URL("./fixtures/mesh-slice/", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, fixture), "utf8");
const readJson = (path: string): unknown => JSON.parse(read(path));
const model = read("components.json");

let program: Nexus.Mesh.Program;

beforeAll(async () => {
  const templateOf = async (component: string, file: string): Promise<string> => {
    const result = await compile({ source: read(file), path: file, model: { manifest: model, path: "components.json", component } });

    if (result.template === undefined) {
      throw new Error(`${file} doesn't compile: ${JSON.stringify(result.diagnostics)}`);
    }

    return JSON.stringify(result.template);
  };

  program = { root: "users", templates: [await templateOf("users", "users.mprx"), await templateOf("user-card", "user-card.mprx")], model };
});

// ---------------------------------------------------------------------------
// The NEXUS side of the slice (spec §7).

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  // Optional, not nullable: an absent avatar must stay absent, because MESH records are exact.
  avatar: Schema.optional(Schema.String),
  active: Schema.Boolean,
});

const Team = Schema.Struct({
  title: Schema.String,
  first: User,
  second: User,
  compact: Schema.Boolean,
  selectedUserId: Schema.OptionFromSelf(Schema.String),
});
type Team = Schema.Schema.Type<typeof Team>;

type Snapshot = Omit<Team, "selectedUserId">;
const first = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String, first: User, second: User, compact: Schema.Boolean }))(readJson("snapshots/first.json"));
const second = Schema.decodeUnknownSync(Schema.Struct({ title: Schema.String, first: User, second: User, compact: Schema.Boolean }))(readJson("snapshots/second.json"));
const initialTeam: Team = { ...first, selectedUserId: Option.none() };

// The scope selector: Team shaped to the manifest, without selectedUserId.
const shaped = ({ title, first, second, compact }: Team): Snapshot => ({ title, first, second, compact });

const UserSelected = Nexus.Event.define("UserSelected", Schema.Struct({ userId: Schema.String }));

const sliceCommands = (team: StateHandle<Team>) => {
  const calls = { select: 0, refresh: 0 };

  const select = Nexus.Command.define("users.select", Schema.Struct({ userId: Schema.String }), ({ userId }) => Effect.Do.pipe(
    Effect.tap(() => Effect.sync(() => { calls.select += 1; })),
    Effect.tap(() => team.update((current) => Effect.succeed({ ...current, selectedUserId: Option.some(userId) }))),
    Effect.andThen(() => Nexus.Event.publish(UserSelected, { userId }))
  ));

  // Stands in for a reload from a repository: the first user becomes second.json's Ada King.
  const refresh = Nexus.Command.define("users.refresh", Schema.Struct({}), () => Effect.Do.pipe(
    Effect.tap(() => Effect.sync(() => { calls.refresh += 1; })),
    Effect.andThen(() => team.update((current) => Effect.succeed({ ...current, first: second.first }))),
    Effect.asVoid
  ));

  // The trust boundary (spec §6.3): MESH checked the argument against the manifest, but TypeScript
  // can't see that, so the binding reads it as the manifest declares it and Command.invoke validates.
  const selectBinding = Mesh.bind(select, (args) => ({ userId: (args[0] as { readonly value: { readonly id: string } }).value.id }));
  const refreshBinding = Mesh.bind(refresh, () => ({}));

  return { select, refresh, calls, selectBinding, refreshBinding, table: { "user-card/selectUser": selectBinding, "users/refresh": refreshBinding } };
};

// ---------------------------------------------------------------------------
// Harness: every test runs inside a started Application that owns the Team
// state, and shuts it down cleanly.

interface Slice {
  readonly running: Nexus.Application.RunningApplication<never>;
  readonly team: StateHandle<Team>;
}

const runSlice = <A, E>(body: (slice: Slice) => Effect.Effect<A, E, Scope.Scope>): Promise<A> => Effect.runPromise(Effect.scoped(Effect.Do.pipe(
  Effect.bind("running", () => Nexus.Application.start(Nexus.Application.define({ name: "mesh-slice", runtime: Layer.empty }))),
  // In the application's runtime scope, so Application.shutdown ends its changes (state.md).
  Effect.bind("team", ({ running }) => Scope.extend(Nexus.State.create(Team, initialTeam), running.runtime.scope)),
  Effect.bind("result", ({ running, team }) => body({ running, team })),
  Effect.tap(({ running }) => Nexus.Application.shutdown(running)),
  Effect.bind("status", ({ running }) => Nexus.Application.status(running)),
  Effect.map(({ result, status }) => {
    expect(status).toEqual({ _tag: "Stopped" });

    return result;
  })
)));

// Runs an effect on the application's runtime (which provides the event bus),
// keeping its typed failures and defects in the returned effect.
const inApp = <A, E>(running: Slice["running"], effect: Effect.Effect<A, E, Nexus.Event.EventBusShape>): Effect.Effect<A, E> =>
  Effect.flatten(Effect.promise(() => Nexus.Runtime.run(running.runtime, Effect.exit(effect))));

// The render tree's nodes in document order.
const nodesOf = (tree: RenderTree): ReadonlyArray<RenderNode> => {
  const walk = (node: RenderNode): ReadonlyArray<RenderNode> => [node, ...node.children.flatMap((child) => child.type === "node" ? walk(child) : [])];

  return walk(tree.root);
};

// Handler ids come from the render's own tree, never hard-coded: they change whenever a template does.
const clickOf = (tree: RenderTree, component: "avatar" | "button", index = 0): string => {
  const handler = nodesOf(tree).filter((node) => node.component === component)[index]?.events["click"];

  if (handler === undefined) {
    throw new Error(`no ${component} #${index} with a click handler`);
  }

  return handler;
};

// The `name` of the user an intent carries as its first argument.
const userNameOf = (dispatched: Nexus.Mesh.Dispatched): string => (dispatched.intent.arguments[0] as { readonly value: { readonly name: string } }).value.name;

// The text of the first user card, as a render tree shows it.
const firstCardName = (tree: RenderTree): unknown => nodesOf(tree).filter((node) => node.component === "avatar")[0]?.props["alt"];

const press = { x: 1, y: 2 };

// The typed failure an exit carries, if it has one.
const failureOf = <A, E>(exit: Exit.Exit<A, E>): Option.Option<E> => Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();

// The diagnostic codes of a MeshDiagnostics failure.
const codesOf = (error: Option.Option<unknown>): ReadonlyArray<string> => Option.match(error, {
  onNone: () => [],
  onSome: (e) => (e as Nexus.Mesh.MeshDiagnostics)._tag === "MeshDiagnostics" ? (e as Nexus.Mesh.MeshDiagnostics).diagnostics.diagnostics.map((d) => d.code) : [],
});

// Waits, boundedly, until `get` satisfies `done`. For assertions, never a bare sleep.
const eventually = <A>(get: Effect.Effect<A>, done: (a: A) => boolean): Effect.Effect<A, unknown> =>
  get.pipe(Effect.filterOrFail(done), Effect.retry(Schedule.spaced("1 millis")), Effect.timeout(Duration.seconds(1)));

describe("MESH adapter (spec §8)", () => {
  it("1. render parity: the selector-built snapshot renders MESH's expected tree", () => runSlice(({ team }) => {
    const { table } = sliceCommands(team);
    const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

    return host.render.pipe(Effect.map((render) => {
      expect(render.tree).toEqual(readJson("expected/first.tree.json"));
    }));
  }));

  it("2. full command round trip: a click becomes users.select, which commits and publishes", () => runSlice(({ running, team }) => {
    const { table, calls } = sliceCommands(team);
    const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

    return Effect.Do.pipe(
      Effect.let("events", () => Nexus.Runtime.runFork(running.runtime, Stream.runCollect(Stream.take(Nexus.Event.subscribe(UserSelected), 1)))),
      Effect.tap(() => Effect.sleep("1 millis")),
      Effect.bind("render", () => host.render),
      Effect.bind("dispatched", ({ render }) => inApp(running, host.dispatch(render, clickOf(render.tree, "avatar", 0), press))),
      Effect.bind("state", () => team.get),
      Effect.bind("published", ({ events }) => Fiber.join(events)),
      Effect.map(({ dispatched, state, published }) => {
        expect(dispatched.intent).toEqual(readJson("expected/select-first.intent.json"));
        expect(state.selectedUserId).toEqual(Option.some("u1"));
        expect(Chunk.toReadonlyArray(published)).toEqual([{ userId: "u1" }]);
        expect(calls.select).toBe(1);
      })
    );
  }));

  it("3. stale event (M1): an event from an old render acts on that render's data, not the newest", () => runSlice(({ running, team }) => {
    const { table, refresh } = sliceCommands(team);
    const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

    return Effect.Do.pipe(
      Effect.bind("a", () => host.render),
      // The click happens on A; its event is only dispatched after the state has moved on.
      Effect.let("clickInA", ({ a }) => clickOf(a.tree, "avatar", 0)),
      Effect.tap(() => inApp(running, Nexus.Command.invoke(refresh, {}))),
      Effect.bind("b", () => host.render),
      Effect.bind("fromA", ({ a, clickInA }) => inApp(running, host.dispatch(a, clickInA, press))),
      Effect.bind("fromB", ({ b }) => inApp(running, host.dispatch(b, clickOf(b.tree, "avatar", 0), press))),
      Effect.map(({ a, b, clickInA, fromA, fromB }) => {
        // F6's hazard: the handler ids are equal, so only the Render tells the two apart.
        expect(clickOf(b.tree, "avatar", 0)).toBe(clickInA);
        expect(firstCardName(a.tree)).toBe("Ada Lovelace");
        expect(firstCardName(b.tree)).toBe("Ada King");
        expect(userNameOf(fromA)).toBe("Ada Lovelace");
        expect(userNameOf(fromB)).toBe("Ada King");
      })
    );
  }));

  it("4. render identity (M1, M2): every render is distinct, and an old one stays intact and dispatchable", () => runSlice(({ running, team }) => {
    const { table, refresh } = sliceCommands(team);
    const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

    return Effect.Do.pipe(
      Effect.bind("a", () => host.render),
      Effect.bind("again", () => host.render),
      Effect.let("treeOfA", ({ a }) => structuredClone(a.tree)),
      Effect.tap(() => inApp(running, Nexus.Command.invoke(refresh, {}))),
      Effect.bind("b", () => host.render),
      Effect.tap(() => team.update((current) => Effect.succeed({ ...current, compact: false }))),
      Effect.bind("fromA", ({ a }) => inApp(running, host.dispatch(a, clickOf(a.tree, "avatar", 0), press))),
      Effect.map(({ a, again, b, treeOfA, fromA }) => {
        // No cache (M2): the same state still yields a new Render.
        expect(again).not.toBe(a);
        expect(b).not.toBe(a);
        expect(a.tree).toEqual(treeOfA);
        expect(userNameOf(fromA)).toBe("Ada Lovelace");
      })
    );
  }));

  it("5. update stream: renders emits one render per future commit, not the state at subscribe time", () => runSlice(({ running, team }) => {
    const { table } = sliceCommands(team);
    const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

    return Effect.Do.pipe(
      Effect.bind("render", () => host.render),
      Effect.let("stream", () => Nexus.Runtime.runFork(running.runtime, Stream.runCollect(Stream.take(host.renders, 1)))),
      Effect.tap(() => Effect.sleep("1 millis")),
      // users.refresh runs through a dispatched click on the Refresh button (no payload).
      Effect.bind("dispatched", ({ render }) => inApp(running, host.dispatch(render, clickOf(render.tree, "button", 0)))),
      Effect.bind("renders", ({ stream }) => Fiber.join(stream)),
      Effect.map(({ dispatched, renders }) => {
        expect(dispatched.intent.command).toEqual({ component: "users", name: "refresh" });
        expect(dispatched.intent.arguments).toEqual([]);
        expect(Chunk.size(renders)).toBe(1);
        expect(Chunk.toReadonlyArray(renders).map((render) => firstCardName(render.tree))).toEqual(["Ada King"]);
      })
    );
  }));

  describe("6. errors (spec §6.4)", () => {
    it("MeshDiagnostics: a scope selector that leaks a field into the exact `first` record", () => runSlice(({ team }) => {
      const { table } = sliceCommands(team);
      const leaky = Nexus.Selector.define(team, (current) => ({ ...shaped(current), first: { ...current.first, selectedUserId: "u1" } }));
      const host = Mesh.host({ program, scope: leaky, commands: table });

      return Effect.exit(host.render).pipe(Effect.map((exit) => {
        expect(codesOf(failureOf(exit))).toContain("runtime-unknown-field");
      }));
    }));

    it("MeshDiagnostics: an unknown handler", () => runSlice(({ running, team }) => {
      const { table } = sliceCommands(team);
      const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

      return host.render.pipe(
        Effect.andThen((render) => Effect.exit(inApp(running, host.dispatch(render, "no-such-handler", press)))),
        Effect.map((exit) => {
          expect(codesOf(failureOf(exit))).toContain("runtime-handler-other-program");
        })
      );
    }));

    it("MeshDiagnostics: a wrong payload", () => runSlice(({ running, team }) => {
      const { table } = sliceCommands(team);
      const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

      return host.render.pipe(
        Effect.andThen((render) => Effect.exit(inApp(running, host.dispatch(render, clickOf(render.tree, "avatar", 0), "oops")))),
        Effect.map((exit) => {
          expect(codesOf(failureOf(exit))).toContain("runtime-value-mismatch");
        })
      );
    }));

    it("UnmappedCommand: an intent with no explicit binding (M3)", () => runSlice(({ running, team }) => {
      const { selectBinding, calls } = sliceCommands(team);
      const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: { "user-card/selectUser": selectBinding } });

      return host.render.pipe(
        Effect.andThen((render) => Effect.exit(inApp(running, host.dispatch(render, clickOf(render.tree, "button", 0))))),
        Effect.map((exit) => {
          expect(failureOf(exit)).toEqual(Option.some({ _tag: "UnmappedCommand", component: "users", name: "refresh" }));
          expect(calls.refresh).toBe(0);
        })
      );
    }));

    it("CommandValidationError: a binding that translates to an invalid input", () => runSlice(({ running, team }) => {
      const { select, calls } = sliceCommands(team);
      const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: { "user-card/selectUser": Mesh.bind(select, () => ({ userId: 42 })) } });

      return host.render.pipe(
        Effect.andThen((render) => Effect.exit(inApp(running, host.dispatch(render, clickOf(render.tree, "avatar", 0), press)))),
        Effect.map((exit) => {
          expect(Option.map(failureOf(exit), (e) => (e as { readonly _tag: string })._tag)).toEqual(Option.some("CommandValidationError"));
          expect(calls.select).toBe(0);
        })
      );
    }));

    it("a toInput throw is a defect, never converted into CommandValidationError", () => runSlice(({ running, team }) => {
      const { select, calls } = sliceCommands(team);
      const broken = new Error("broken binding");
      const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: { "user-card/selectUser": Mesh.bind(select, () => { throw broken; }) } });

      return host.render.pipe(
        Effect.andThen((render) => Effect.exit(inApp(running, host.dispatch(render, clickOf(render.tree, "avatar", 0), press)))),
        Effect.map((exit) => {
          expect(Exit.isFailure(exit)).toBe(true);
          expect(Exit.isFailure(exit) && Cause.isDie(exit.cause)).toBe(true);
          expect(Exit.isFailure(exit) ? Cause.dieOption(exit.cause) : Option.none()).toEqual(Option.some(broken));
          expect(failureOf(exit)).toEqual(Option.none());
          expect(calls.select).toBe(0);
        })
      );
    }));

    it("a Render the runtime didn't make is a defect (TypeError), not a typed failure", () => runSlice(({ running, team }) => {
      const { table } = sliceCommands(team);
      const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

      return host.render.pipe(
        Effect.andThen((render) => {
          const forged = { tree: render.tree } as unknown as Nexus.Mesh.Render;

          return Effect.exit(inApp(running, host.dispatch(forged, clickOf(render.tree, "avatar", 0), press)));
        }),
        Effect.map((exit) => {
          expect(failureOf(exit)).toEqual(Option.none());
          expect(Exit.isFailure(exit) ? Option.getOrUndefined(Cause.dieOption(exit.cause)) : undefined).toBeInstanceOf(TypeError);
        })
      );
    }));
  });

  it("7. shutdown: Application.shutdown ends a renders subscription without error", () => runSlice(({ running, team }) => {
    const { table, refresh } = sliceCommands(team);
    const host = Mesh.host({ program, scope: Nexus.Selector.define(team, shaped), commands: table });

    return Effect.Do.pipe(
      Effect.bind("seen", () => Ref.make<ReadonlyArray<Nexus.Mesh.Render>>([])),
      Effect.let("consumer", ({ seen }) => Nexus.Runtime.runFork(running.runtime, Stream.runForEach(host.renders, (render) => Ref.update(seen, (xs) => [...xs, render])))),
      Effect.tap(() => Effect.sleep("1 millis")),
      Effect.tap(() => inApp(running, Nexus.Command.invoke(refresh, {}))),
      Effect.tap(({ seen }) => eventually(Ref.get(seen), (xs) => xs.length === 1)),
      // The adapter has no lifecycle of its own: the stream ends because the
      // application's scope owns the Team state, whose changes then complete.
      Effect.tap(() => Nexus.Application.shutdown(running)),
      Effect.bind("exit", ({ consumer }) => Fiber.await(consumer).pipe(Effect.timeout(Duration.seconds(1)))),
      Effect.bind("seenAtEnd", ({ seen }) => Ref.get(seen)),
      Effect.map(({ exit, seenAtEnd }) => {
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(seenAtEnd.map((render) => firstCardName(render.tree))).toEqual(["Ada King"]);
      })
    );
  }));

  it("8. render failure is terminal: a malformed snapshot fails and ends renders, and nothing stale is emitted", () => runSlice(({ running, team }) => {
    const { table, select, refresh } = sliceCommands(team);
    // Valid while nothing is selected; leaks selectedUserId into the exact `first` record once something is.
    const leaksSelection = Nexus.Selector.define(team, (current) => Option.match(current.selectedUserId, {
      onNone: () => shaped(current),
      onSome: (id) => ({ ...shaped(current), first: { ...current.first, selectedUserId: id } }),
    }));
    const host = Mesh.host({ program, scope: leaksSelection, commands: table });

    return Effect.Do.pipe(
      Effect.bind("seen", () => Ref.make<ReadonlyArray<Nexus.Mesh.Render>>([])),
      Effect.let("consumer", ({ seen }) => Nexus.Runtime.runFork(running.runtime, Stream.runForEach(host.renders, (render) => Ref.update(seen, (xs) => [...xs, render])))),
      Effect.tap(() => Effect.sleep("1 millis")),
      // 1. A valid commit: exactly one render, showing Ada King.
      Effect.tap(() => inApp(running, Nexus.Command.invoke(refresh, {}))),
      Effect.bind("step1", ({ seen }) => eventually(Ref.get(seen), (xs) => xs.length === 1)),
      // 2. A malformed commit: the stream fails with MeshDiagnostics and ends.
      Effect.tap(() => inApp(running, Nexus.Command.invoke(select, { userId: "u1" }))),
      Effect.bind("failed", ({ consumer }) => Fiber.await(consumer).pipe(Effect.timeout(Duration.seconds(1)))),
      // 3. Valid again, set directly: the subject is the stream's failure semantics, not command flow.
      Effect.tap(() => team.update((current) => Effect.succeed({ ...current, selectedUserId: Option.none() }))),
      Effect.tap(() => Effect.sleep("20 millis")),
      // 4. Nothing for the failed commit, no re-emitted step 1 render, nothing for step 3.
      Effect.bind("seenAtEnd", ({ seen }) => Ref.get(seen)),
      Effect.bind("afterStep3", ({ consumer }) => Fiber.poll(consumer)),
      // 5. The host kept nothing: a fresh render of the current state succeeds.
      Effect.bind("fresh", () => host.render),
      Effect.map(({ step1, failed, seenAtEnd, afterStep3, fresh }) => {
        expect(step1.map((render) => firstCardName(render.tree))).toEqual(["Ada King"]);

        expect(Exit.isFailure(failed)).toBe(true);
        expect(Exit.isFailure(failed) && Cause.isDie(failed.cause)).toBe(false);
        expect(codesOf(failureOf(failed))).toContain("runtime-unknown-field");

        expect(seenAtEnd).toHaveLength(1);
        expect(seenAtEnd[0]).toBe(step1[0]);
        expect(afterStep3).toEqual(Option.some(failed));

        expect(firstCardName(fresh.tree)).toBe("Ada King");
      })
    );
  }));
});
