/**
 * The MESH host adapter: the thin integration boundary between NEXUS and
 * `@valancex/mesh-runtime` (spec §5). It translates a selector value into a
 * MESH snapshot, and a MESH command intent into a NEXUS `Command.invoke`,
 * through an explicit binding. It adds no reactive model, render registry,
 * component lifecycle or command runtime.
 *
 * Normative invariants (spec §5.2):
 * - M1: `dispatch` operates against exactly the `Render` the caller supplied.
 * - M2: no render registry; no `Render` is retained for later lookup.
 * - M3: an intent reaches behavior only through an explicit `commands` entry.
 * - M4: only `@valancex/mesh-runtime` is used; never the MESH compiler.
 */
import type { CommandIntent, IntentArgument, Render, RuntimeDiagnosticsDocument } from "@valancex/mesh-runtime";
import type { Command, CommandValidationError } from "../command/index.js";
import type { SelectorHandle } from "../selector/index.js";

import { dispatch as meshDispatch, render as meshRender } from "@valancex/mesh-runtime";
import { Effect, Stream } from "effect";

import * as NexusCommand from "../command/index.js";

export type { CommandIntent, IntentArgument, Render, RuntimeDiagnosticsDocument };

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

/** Translates a command intent's arguments into a NEXUS command's input, then invokes it. */
export type Binding<E, R> = (args: ReadonlyArray<IntentArgument>) => Effect.Effect<unknown, E, R>;

export interface Host<E, R> {
  /** Renders the scope selector's current value. */
  readonly render: Effect.Effect<Render, MeshDiagnostics>;
  /** One render per future scope commit. A diagnostic fails and ends the stream (spec §6.2). */
  readonly renders: Stream.Stream<Render, MeshDiagnostics>;
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
const renderSnapshot = (program: Program, snapshot: Record<string, unknown>): Effect.Effect<Render, MeshDiagnostics> =>
  Effect.promise(() => meshRender({ program: { root: program.root, templates: program.templates }, model: program.model, snapshot })).pipe(
    Effect.flatMap((result) => result.diagnostics === undefined
      ? Effect.succeed(result.render)
      : Effect.fail<MeshDiagnostics>({ _tag: "MeshDiagnostics", diagnostics: result.diagnostics }))
  );

export const host = <E, R>(options: {
  readonly program: Program;
  readonly scope: SelectorHandle<Record<string, unknown>>; // already shaped to the manifest (records are exact)
  readonly commands: Readonly<Record<string, Binding<E, R>>>; // key: "component/name"
}): Host<E, R> => {
  const { program, scope, commands } = options;

  return {
    render: Effect.flatMap(scope.value, (snapshot) => renderSnapshot(program, snapshot)),
    // Sequential, future commits only, and a failed render ends the stream.
    // That's Effect's default for mapEffect, and it's the v0.2 NEXUS contract.
    renders: Stream.mapEffect(scope.changes, (snapshot) => renderSnapshot(program, snapshot)),
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
          : Effect.map(binding(intent.arguments), (output): Dispatched => ({ intent, output }));
      })
    ),
  };
};
