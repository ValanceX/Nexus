/**
 * The MESH host adapter: the thin integration boundary between NEXUS and
 * `@valancex/mesh-runtime` (spec §5). It translates a selector value into a
 * MESH snapshot, and a MESH command intent into a NEXUS `Command.invoke`,
 * through an explicit binding. It adds no reactive model, render registry,
 * component lifecycle or command runtime. For a component's unit (state for one occurrence) it passes the host's state to the
 * runtime and the intent to the binding, and keeps none of it: the host holds the state and decides when an occurrence's ends.
 * The context values (MESH 0.18's context channel: names the manifest declares once and a component lists in `uses`) are passed
 * the same way, beside the snapshot, and kept nowhere.
 *
 * Normative invariants (spec §5.2):
 * - M1: `dispatch` operates against exactly the `Render` the caller supplied.
 * - M2: no render registry; no `Render` is retained for later lookup.
 * - M3: an intent reaches behavior only through an explicit `commands` entry.
 * - M4: only `@valancex/mesh-runtime` is used; never the MESH compiler.
 */
import type { CommandIntent as RuntimeIntent, IntentArgument, Render, RenderPatches, RuntimeDiagnosticsDocument } from "@valancex/mesh-runtime";
import type { Command, CommandValidationError } from "../command/index.js";
import type { SelectorHandle } from "../selector/index.js";

import * as MeshRuntime from "@valancex/mesh-runtime";
import { dispatch as meshDispatch, render as meshRender, update as meshUpdate } from "@valancex/mesh-runtime";
import { Effect, Stream } from "effect";

import * as NexusCommand from "../command/index.js";

export type { IntentArgument, Render, RenderPatches, RuntimeDiagnosticsDocument };

/**
 * A command intent. A command of a component's unit names the occurrence it is for (`occurrence`, MESH 0.18; `instance` in MESH 0.15 to 0.17) and the fields the caller owned (`controlled`, from
 * MESH 0.15). Written here and not taken from the runtime's types, so that this adapter builds and runs against MESH 0.14, which has neither.
 */
export type CommandIntent = RuntimeIntent & {
  readonly occurrence?: string;
  /**
   * The old name of `occurrence`: the only one MESH 0.15 to 0.17 give, and a deprecated alias in MESH 0.18 (not enumerable, removed after it).
   * @deprecated Read `occurrence` (MESH 0.18, refinements C-4).
   */
  readonly instance?: string;
  readonly controlled?: ReadonlyArray<string>;
};

/** One occurrence of a component with a unit in a render (MESH 0.18's `Render.occurrences`; `Render.instances` in MESH 0.15 to 0.17). */
export interface UnitOccurrence {
  /** The occurrence's key (MESH 0.18). */
  readonly occurrence: string;
  /**
   * The old name of `occurrence`: the only one MESH 0.15 to 0.17 give, and a deprecated alias in MESH 0.18 (not enumerable, removed after it).
   * @deprecated Read `occurrence` (MESH 0.18, refinements C-4).
   */
  readonly instance: string;
  readonly component: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly controlled?: ReadonlyArray<string>;
}

/** The state the host holds for the unit occurrences, by the occurrence's key. */
export type UnitStates = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** The values of the manifest's context channel the host holds, by context name (MESH 0.18). */
export type ContextValues = Readonly<Record<string, unknown>>;

export interface Program {
  readonly root: string;
  readonly templates: ReadonlyArray<string>; // template-v1 JSON text, compiled at build time
  readonly model: string;                    // the manifest's text
}

/** MESH rejected the render or dispatch input. */
export type MeshDiagnostics = { readonly _tag: "MeshDiagnostics"; readonly diagnostics: RuntimeDiagnosticsDocument };

/** No explicit binding exists for the intent's command. */
export type UnmappedCommand = { readonly _tag: "UnmappedCommand"; readonly component: string; readonly name: string };

export interface Dispatched {
  readonly intent: CommandIntent;
  readonly output: unknown;
}

/**
 * Translates a command intent's arguments into a NEXUS command's input, then invokes it. The intent itself is the second argument, for
 * a binding that needs more than the arguments: the occurrence of a component's unit it is for (`intent.occurrence`) and the fields the
 * caller owned (`intent.controlled`). It is absent when the command is run by name (`invoke`), not from an event. A binding that does not need it takes one parameter, as before.
 */
export type Binding<E, R> = (args: ReadonlyArray<IntentArgument>, intent?: CommandIntent) => Effect.Effect<unknown, E, R>;

export interface Host<E, R> {
  /** Renders the scope selector's current value. */
  readonly render: Effect.Effect<Render, MeshDiagnostics>;
  /** One render per future scope commit. A diagnostic fails and ends the stream (spec §6.2). */
  readonly renders: Stream.Stream<Render, MeshDiagnostics>;
  /**
   * The render of the scope's value current at subscription, then one per later commit, in commit order.
   * The current value and the subscription to later commits are one atomic step (`Selector.values`), so a
   * commit made while the first render is being produced is rendered next, never lost. The caller still
   * decides what each render means (draw, update); the adapter keeps none (M2). Failure and ending as `renders`.
   */
  readonly values: Stream.Stream<Render, MeshDiagnostics>;
  readonly dispatch: (render: Render, handler: string, payload?: unknown) => Effect.Effect<Dispatched, MeshDiagnostics | UnmappedCommand | E, R>;
}

/**
 * `toInput` is the trust boundary between dynamically shaped intent arguments
 * and typed command input: `Command.invoke` validates what it returns. A throw
 * in `toInput` is a broken binding, so it's a defect, never a
 * `CommandValidationError` (spec §6.3).
 */
export const bind = <I, O, E, R, X = I>(command: Command<I, O, E, R, X>, toInput: (args: ReadonlyArray<IntentArgument>) => unknown): Binding<E | CommandValidationError, R> =>
  (args) => Effect.sync(() => toInput(args)).pipe(Effect.flatMap((input) => NexusCommand.invoke(command, input)));

// A rejection from the runtime is a programming, package or runtime defect, so
// it's Effect.promise (a defect), never a typed failure (spec §6.4).
// `units` and `context` are left out when absent, so an older MESH is given exactly the input it knows.
const renderSnapshot = (program: Program, snapshot: Record<string, unknown>, units?: UnitStates, context?: ContextValues): Effect.Effect<Render, MeshDiagnostics> =>
  Effect.promise(() => meshRender({ program: { root: program.root, templates: program.templates }, model: program.model, snapshot, ...(units === undefined ? {} : { units }), ...(context === undefined ? {} : { context }) } as never)).pipe(Effect.flatMap((result) => result.diagnostics === undefined
    ? Effect.succeed(result.render)
    : Effect.fail<MeshDiagnostics>({ _tag: "MeshDiagnostics", diagnostics: result.diagnostics }))
  );

/**
 * Renders `snapshot` and, beside it, the state the host holds for the unit occurrences (`units`: the occurrence's key, then its state; without it,
 * every occurrence has its unit's defaults) and the context values (`context`: by context name; MESH 0.18, needed when the manifest declares a context
 * name whose type is not optional). The runtime's operation and nothing more: the adapter keeps no state of the occurrences and no context (M2), the host does.
 */
export const render = (program: Program, snapshot: Record<string, unknown>, units?: UnitStates, context?: ContextValues): Effect.Effect<Render, MeshDiagnostics> =>
  renderSnapshot(program, snapshot, units, context);

/** The new render of an update, and the `render-patch-v1` operations that turn the previous render's tree into its tree. */
export interface Updated {
  readonly render: Render;
  readonly patches: RenderPatches;
}

/**
 * Updates `previous` to a new `snapshot` of the same program: MESH reuses everything the snapshot leaves unchanged, and returns the new render and the patches a renderer applies
 * in place. Like `render`, it is the runtime's operation and nothing more: it keeps no render (M2), and a rejection from the runtime is a defect. `previous` is untouched, and
 * still dispatches, when MESH refuses the snapshot. `previous` must be a render of the same program, which only the caller knows. Without `units`, or without `context`,
 * MESH keeps the previous render's.
 */
export const update = (previous: Render, snapshot: Record<string, unknown>, units?: UnitStates, context?: ContextValues): Effect.Effect<Updated, MeshDiagnostics> =>
  Effect.promise(() =>
    // Trailing absent arguments are not passed, so an older MESH is called exactly as it was before it had them.
    context !== undefined
      ? meshUpdate(previous, snapshot, units as UnitStates, context as Record<string, unknown>)
      : units !== undefined
        ? meshUpdate(previous, snapshot, units as UnitStates)
        : meshUpdate(previous, snapshot)
  ).pipe(Effect.flatMap((result) => result.diagnostics === undefined
    ? Effect.succeed<Updated>({ render: result.render, patches: result.patches })
    : Effect.fail<MeshDiagnostics>({ _tag: "MeshDiagnostics", diagnostics: result.diagnostics })
  ));

/**
 * Raises an event of a unit occurrence (`render.occurrences` lists them) and gives the intent of the handler the caller bound to it, if it bound one.
 * The runtime's operation and nothing more: it renders nothing and changes nothing, and what the host does with the intent is the host's.
 */
export const raise = (render: Render, occurrence: string, event: string, payload?: unknown): Effect.Effect<CommandIntent | undefined, MeshDiagnostics> =>
  Effect.promise(() => {
    const meshRaise = (MeshRuntime as unknown as { readonly raise?: (r: Render, i: string, e: string, p?: unknown) => Promise<{ readonly intent?: CommandIntent; readonly diagnostics?: RuntimeDiagnosticsDocument }> }).raise;

    if (meshRaise === undefined) {
      throw new Error("NEXUS: raising an event of a unit needs @valancex/mesh-runtime 0.15");
    }

    return meshRaise(render, occurrence, event, payload);
  }).pipe(Effect.flatMap((result) => result.diagnostics === undefined
    ? Effect.succeed(result.intent)
    : Effect.fail<MeshDiagnostics>({ _tag: "MeshDiagnostics", diagnostics: result.diagnostics })
  ));

type HostOptions<E, R> = {
  readonly program: Program;
  readonly scope: SelectorHandle<Record<string, unknown>>; // already shaped to the manifest (records are exact)
  readonly commands: Readonly<Record<string, Binding<E, R>>>; // key: "component/name"
  /**
   * Optional. The state the host holds for the unit occurrences, read each time the host renders: handed to the runtime as it is, with no logic. Without
   * it every occurrence has its unit's defaults, and a program with no units never needs it.
   */
  readonly units?: Effect.Effect<UnitStates>;
  /**
   * Optional (MESH 0.18). The context values the host holds, read each time the host renders and handed to the runtime beside the snapshot as they are, with
   * no logic. Like `units`, it is read when the scope renders: a change of context alone does not render. A program whose manifest declares no context never needs it.
   */
  readonly context?: Effect.Effect<ContextValues>;
}

export const host = <E, R>({ program, scope, commands, units, context }: HostOptions<E, R>): Host<E, R> => {
  // What the host holds beside the snapshot, read at each render; absent inputs are absent, not empty.
  const none = Effect.succeed(undefined);
  const rendered = (snapshot: Record<string, unknown>): Effect.Effect<Render, MeshDiagnostics> =>
    Effect.Do.pipe(
      Effect.bind("held", () => units ?? none),
      Effect.bind("given", () => context ?? none),
      Effect.flatMap(({ held, given }) => renderSnapshot(program, snapshot, held, given))
    );

  return {
    render: Effect.flatMap(scope.value, rendered),
    // Sequential, future commits only, and a failed render ends the stream.
    // That's Effect's default for mapEffect, and it's the v0.2 NEXUS contract.
    renders: Stream.mapEffect(scope.changes, rendered),
    values: Stream.mapEffect(scope.values, rendered),
    // M1: `render` goes to the runtime exactly as the caller supplied it.
    dispatch: (render, handler, payload) => Effect.promise(() => meshDispatch(render, handler, payload)).pipe(
      Effect.flatMap((result) => result.diagnostics === undefined
        ? Effect.succeed(result.intent)
        : Effect.fail<MeshDiagnostics>({ _tag: "MeshDiagnostics", diagnostics: result.diagnostics })),
      Effect.flatMap((intent): Effect.Effect<Dispatched, UnmappedCommand | E, R> => {
        const { component, name } = intent.command;
        const key = `${component}/${name}`;
        // M3: own entries only, so nothing inherited (e.g. from Object.prototype) can act as a binding.
        const binding = Object.hasOwn(commands, key) ? commands[key] : undefined;

        return binding === undefined
          ? Effect.fail<UnmappedCommand>({ _tag: "UnmappedCommand", component, name })
          : Effect.map(binding(intent.arguments, intent), (output): Dispatched => ({ intent, output }));
      })
    ),
  };
};
