/**
 * The MESH host adapter: the thin integration boundary between NEXUS and
 * `@valancex/mesh-runtime` (spec §5). It translates a selector value into a
 * MESH snapshot, and a MESH command intent into a NEXUS `Command.invoke`,
 * through an explicit binding. It adds no reactive model, render registry,
 * component lifecycle or command runtime. For a component's unit (state for one occurrence) it passes the host's state to the
 * runtime and the intent to the binding, and keeps none of it: the host holds the state and decides when an occurrence's ends.
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
 * A command intent. From MESH 0.15, a command of a component's unit names the occurrence it is for (`instance`) and the fields the caller owned (`controlled`). Written here and not taken from the
 * runtime's types, so that this adapter builds and runs against MESH 0.14, which has neither.
 */
export type CommandIntent = RuntimeIntent & { readonly instance?: string; readonly controlled?: ReadonlyArray<string> };

/** One occurrence of a component with a unit in a render (MESH 0.15's `Render.instances`). */
export interface UnitOccurrence {
  readonly instance: string;
  readonly component: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly controlled?: ReadonlyArray<string>;
}

/** The state the host holds for the unit occurrences, by the occurrence's key. */
export type UnitStates = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

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
 * a binding that needs more than the arguments: the occurrence of a component's unit it is for (`intent.instance`) and the fields the
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
export const bind = <I, O, E, R>(command: Command<I, O, E, R>, toInput: (args: ReadonlyArray<IntentArgument>) => unknown): Binding<E | CommandValidationError, R> =>
  (args) => Effect.sync(() => toInput(args)).pipe(Effect.flatMap((input) => NexusCommand.invoke(command, input)));

// A rejection from the runtime is a programming, package or runtime defect, so
// it's Effect.promise (a defect), never a typed failure (spec §6.4).
const renderSnapshot = (program: Program, snapshot: Record<string, unknown>, units?: UnitStates): Effect.Effect<Render, MeshDiagnostics> =>
  Effect.promise(() => meshRender({ program: { root: program.root, templates: program.templates }, model: program.model, snapshot, ...(units === undefined ? {} : { units }) } as never)).pipe(Effect.flatMap((result) => result.diagnostics === undefined
    ? Effect.succeed(result.render)
    : Effect.fail<MeshDiagnostics>({ _tag: "MeshDiagnostics", diagnostics: result.diagnostics }))
  );

/**
 * Renders `snapshot` and, beside it, the state the host holds for the unit occurrences (`units`: the occurrence's key, then its state; without it,
 * every occurrence has its unit's defaults). The runtime's operation and nothing more: the adapter keeps no state of the occurrences (M2), the host does.
 */
export const render = (program: Program, snapshot: Record<string, unknown>, units?: UnitStates): Effect.Effect<Render, MeshDiagnostics> => renderSnapshot(program, snapshot, units);

/** The new render of an update, and the `render-patch-v1` operations that turn the previous render's tree into its tree. */
export interface Updated {
  readonly render: Render;
  readonly patches: RenderPatches;
}

/**
 * Updates `previous` to a new `snapshot` of the same program: MESH reuses everything the snapshot leaves unchanged, and returns the new render and the patches a renderer applies
 * in place. Like `render`, it is the runtime's operation and nothing more: it keeps no render (M2), and a rejection from the runtime is a defect. `previous` is untouched, and
 * still dispatches, when MESH refuses the snapshot. `previous` must be a render of the same program, which only the caller knows.
 */
export const update = (previous: Render, snapshot: Record<string, unknown>, units?: UnitStates): Effect.Effect<Updated, MeshDiagnostics> =>
  Effect.promise(() => (units === undefined ? meshUpdate(previous, snapshot) : (meshUpdate as (p: Render, s: Record<string, unknown>, u: UnitStates) => ReturnType<typeof meshUpdate>)(previous, snapshot, units))).pipe(Effect.flatMap((result) => result.diagnostics === undefined
    ? Effect.succeed<Updated>({ render: result.render, patches: result.patches })
    : Effect.fail<MeshDiagnostics>({ _tag: "MeshDiagnostics", diagnostics: result.diagnostics })
  ));

/**
 * Raises an event of a unit occurrence (`render.instances` lists them) and gives the intent of the handler the caller bound to it, if it bound one.
 * The runtime's operation and nothing more: it renders nothing and changes nothing, and what the host does with the intent is the host's.
 */
export const raise = (render: Render, instance: string, event: string, payload?: unknown): Effect.Effect<CommandIntent | undefined, MeshDiagnostics> =>
  Effect.promise(() => {
    const meshRaise = (MeshRuntime as unknown as { readonly raise?: (r: Render, i: string, e: string, p?: unknown) => Promise<{ readonly intent?: CommandIntent; readonly diagnostics?: RuntimeDiagnosticsDocument }> }).raise;

    if (meshRaise === undefined) {
      throw new Error("NEXUS: raising an event of a unit needs @valancex/mesh-runtime 0.15");
    }

    return meshRaise(render, instance, event, payload);
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
}

export const host = <E, R>({ program, scope, commands, units }: HostOptions<E, R>): Host<E, R> => {
  const rendered = (snapshot: Record<string, unknown>): Effect.Effect<Render, MeshDiagnostics> =>
    units === undefined ? renderSnapshot(program, snapshot) : Effect.flatMap(units, (held) => renderSnapshot(program, snapshot, held));

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
