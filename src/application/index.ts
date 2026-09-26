import type { EventBusShape } from "../event/index.js";

import { Deferred, Effect, Exit, Layer, Ref, Schema, Scope } from "effect";

import type { StateHandle, StateInitError } from "../state/index.js";

import * as Capability from "../capability/index.js";
import * as Runtime from "../runtime/index.js";
import { refusal, scopeOf, terminate } from "../runtime/internal.js";
import * as State from "../state/index.js";

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
  readonly runtime: Runtime.NexusRuntime<R | Capability.EnvironmentShape | EventBusShape>;
  readonly environment: Capability.EnvironmentShape;
}

// A running application's lifecycle. Deliberately not reachable from the
// RunningApplication value: a public, writable status Ref would let any holder
// forge a lifecycle transition.
interface AppRecord {
  readonly statusRef: Ref.Ref<ApplicationStatus>;
  readonly stopped: Deferred.Deferred<void>;
  readonly runtime: Runtime.NexusRuntime<never>;
}

const apps = new WeakMap<object, AppRecord>();

/**
 * Terminates the application, once (N2). The first caller claims the termination
 * (`Running` → `Stopping`), terminates the runtime (no new work, bus closed,
 * resources released), then sets `Stopped`. Every other caller waits for
 * `Stopped`; none writes a status. Uninterruptible, so a started termination
 * always completes.
 */
const terminateApplication = (record: AppRecord): Effect.Effect<void> => Effect.uninterruptible(
  Ref.modify(record.statusRef, (current): [boolean, ApplicationStatus] => current._tag === "Running"
    ? [true, { _tag: "Stopping" }]
    : [false, current]
  ).pipe(Effect.andThen((claimed) => claimed
    ? terminate(record.runtime).pipe(
      Effect.andThen(Ref.set(record.statusRef, { _tag: "Stopped" })),
      Effect.andThen(Deferred.succeed(record.stopped, undefined)),
      Effect.asVoid
    )
    : Deferred.await(record.stopped)
  ))
);

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
  Effect.bind("stopped", () => Deferred.make<void>()),
  Effect.let("record", ({ statusRef, stopped, runtime }): AppRecord => ({ statusRef, stopped, runtime })),
  // Route 2: closing the caller's start scope terminates the application exactly
  // as Application.shutdown does. Added after Runtime.make's own finalizer, so it
  // runs first; that one then finds the runtime already terminated.
  Effect.tap(({ record }) => Effect.addFinalizer(() => terminateApplication(record))),
  Effect.map(({ statusRef, runtime, environment, record }): RunningApplication<R> => {
    const running: RunningApplication<R> = Object.freeze({ status: Ref.get(statusRef), runtime, environment });

    apps.set(running, record);

    return running;
  })
);

// Route 1. Idempotent, and never fails: every call returns once the status is `Stopped`.
export const shutdown = <R>(running: RunningApplication<R>): Effect.Effect<void> => {
  const record = apps.get(running);

  return record === undefined ? Effect.die(refusal("not an application NEXUS started")) : terminateApplication(record);
};

export const status = <R>(running: RunningApplication<R>): Effect.Effect<ApplicationStatus> => running.status;

/**
 * Application-owned State (D1): created in the application runtime's own scope,
 * so it ends with the application. The caller supplies no Scope.
 */
export const createState = <R, A>(running: RunningApplication<R>, schema: Schema.Schema<A>, initial: A): Effect.Effect<StateHandle<A>, StateInitError> => {
  const scope = scopeOf(running.runtime);

  return scope === undefined
    ? Effect.die(refusal("not an application NEXUS started"))
    : Scope.extend(State.create(schema, initial), scope);
};
