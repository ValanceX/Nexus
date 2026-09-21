import type { EventBusShape } from "../event/index.js";

import { Effect, Exit, Layer, Ref, Scope } from "effect";

import * as Capability from "../capability/index.js";
import * as Runtime from "../runtime/index.js";

export type ApplicationStatus =
  | { readonly _tag: "Created" }
  | { readonly _tag: "Initializing" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Stopping" }
  | { readonly _tag: "Stopped" }
  | { readonly _tag: "Failed"; readonly error: ApplicationInitError };

export type ApplicationInitError =
  | { readonly _tag: "EnvironmentResolutionFailed"; readonly cause: unknown }
  | { readonly _tag: "ServiceGraphFailed"; readonly cause: unknown };

/**
 * The ambient services an application always resolves before its own service
 * graph is considered ready, and which a user layer may therefore declare as
 * its own requirements (application.md: "`start` must resolve `Environment`
 * before the service graph is considered ready, since services may themselves
 * depend on resolved capabilities").
 */
export type ApplicationAmbient = Capability.EnvironmentShape | EventBusShape;

export interface ApplicationDefinition<R> {
  readonly name: string;
  readonly runtime: Layer.Layer<R, unknown, ApplicationAmbient>;
  readonly environment?: ReadonlyMap<string, Capability.CapabilityResolution<unknown>>;
}

export interface Application<R> {
  readonly definition: ApplicationDefinition<R>;
}

export interface RunningApplication<R> {
  readonly status: Effect.Effect<ApplicationStatus>;
  // `shutdown` is a closure bound to this application's private status Ref.
  // The Ref itself is deliberately not a field: a public, writable Ref would
  // let any holder forge a lifecycle transition.
  readonly shutdown: Effect.Effect<void>;
  readonly runtime: Runtime.NexusRuntime<R | Capability.EnvironmentShape | EventBusShape>;
  readonly environment: Capability.EnvironmentShape;
}

export const define = <R>(definition: ApplicationDefinition<R>): Application<R> => ({ definition });

export const start = <R>(app: Application<R>): Effect.Effect<RunningApplication<R>, ApplicationInitError, Scope.Scope> => Effect.Do.pipe(
  Effect.bind("statusRef", () => Ref.make<ApplicationStatus>({ _tag: "Created" })),
  Effect.tap(({ statusRef }) => Ref.set(statusRef, { _tag: "Initializing" })),
  Effect.let("resolutions", () => app.definition.environment ?? new Map<string, Capability.CapabilityResolution<unknown>>()),
  Effect.let("environment", ({ resolutions }): Capability.EnvironmentShape => ({ resolutions })),
  // Provide-merge, not merge: Environment is resolved first and fed into the
  // user's runtime layer (so a Service/Command layer may require it), while
  // staying in the final context so Capability.resolve also works directly
  // through `RunningApplication.runtime`.
  //
  // `Effect.exit` rather than a plain failure so the status Ref records
  // `Failed` before the error escapes — callers observing status after a failed
  // `start` must not see a stale `Initializing`.
  Effect.bind("runtime", ({ resolutions, statusRef }): Effect.Effect<Runtime.NexusRuntime<R | Capability.EnvironmentShape | EventBusShape>, ApplicationInitError, Scope.Scope> =>
    Effect.exit(Runtime.make(Layer.provideMerge(app.definition.runtime, Capability.EnvironmentLive(resolutions)))).pipe(
      Effect.andThen((exit) => {
        if (Exit.isFailure(exit)) {
          const error: ApplicationInitError = { _tag: "ServiceGraphFailed", cause: exit.cause };

          return Ref.set(statusRef, { _tag: "Failed", error }).pipe(Effect.andThen(Effect.fail(error)));
        }

        return Effect.succeed(exit.value);
      })
    )
  ),
  Effect.tap(({ statusRef }) => Ref.set(statusRef, { _tag: "Running" })),
  Effect.map(({ statusRef, runtime, environment }): RunningApplication<R> => ({
    status: Ref.get(statusRef),
    shutdown: Effect.Do.pipe(
      Effect.andThen(Ref.set(statusRef, { _tag: "Stopping" })),
      Effect.andThen(Runtime.shutdown(runtime)),
      Effect.andThen(Ref.set(statusRef, { _tag: "Stopped" }))
    ),
    runtime,
    environment,
  }))
);

export const shutdown = <R>(running: RunningApplication<R>): Effect.Effect<void> => running.shutdown;

export const status = <R>(running: RunningApplication<R>): Effect.Effect<ApplicationStatus> => running.status;
