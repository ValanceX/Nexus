import type { StateHandle, StateInitError } from "../state/index.js";
import type { EventBusShape } from "../event/index.js";

import { admit, recordOf, refusal, setHooks, terminate, windingScopeOf } from "../runtime/internal.js";
import { Context, Duration, Effect, Exit, Layer, Ref, Schema, Scope } from "effect";

import * as Capability from "../capability/index.js";
import * as Runtime from "../runtime/index.js";
import * as State from "../state/index.js";

export type ApplicationStatus =
  | { readonly _tag: "Created" }
  | { readonly _tag: "Initializing" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Stopping" }
  | { readonly _tag: "Stopped" }
  | { readonly _tag: "Failed"; readonly error: ApplicationInitError };

// The one initialization failure (v0.6 D34). The platform's build is part of the
// application's service graph build, so a platform failure is ServiceGraphFailed
// too; its `cause` tells them apart.
export type ApplicationInitError = { readonly _tag: "ServiceGraphFailed"; readonly cause: unknown };

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
}

export interface Application<R> {
  readonly definition: ApplicationDefinition<R>;
}

/**
 * The platform contract (v0.6 D30, C16): what supplies an application's
 * environment. Any Layer that provides the resolved Environment and requires
 * nothing. Host-owned implementations come as values (Capability.EnvironmentLive);
 * application-scoped ones as a scoped layer. The platform Layer is provided to
 * the application-owned runtime scope, so the application's lifetime governs
 * acquisition and release: platform first in, last out (C15, I31).
 */
export type Platform = Layer.Layer<Capability.EnvironmentShape, unknown, never>;

/**
 * The shape of the application-host boundary (v0.6 D30, D42). It holds exactly
 * the one justified start concern, `platform`. It is not a configuration bag:
 * any further field needs its own architectural decision.
 */
export interface StartOptions {
  readonly platform?: Platform;
  /** How the application ends when its start scope closes, or `shutdown` is called without options: see `Runtime.ShutdownOptions`. */
  readonly shutdown?: Runtime.ShutdownOptions;
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
  readonly runtime: Runtime.NexusRuntime<never>;
}

const apps = new WeakMap<object, AppRecord>();

// Absent platform: the empty environment, exactly v0.5's absent `environment` (D30).
const noPlatform: Platform = Capability.EnvironmentLive(new Map());

export const define = <R>(definition: ApplicationDefinition<R>): Application<R> => ({ definition });

export const start = <R>(app: Application<R>, options?: StartOptions): Effect.Effect<RunningApplication<R>, ApplicationInitError, Scope.Scope> => Effect.Do.pipe(
  Effect.bind("statusRef", () => Ref.make<ApplicationStatus>({ _tag: "Created" })),
  Effect.tap(({ statusRef }) => Ref.set(statusRef, { _tag: "Initializing" })),
  // The single supply point for the environment (D30, I29).
  Effect.let("platform", (): Platform => options?.platform ?? noPlatform),
  // Provide-merge, not merge: the platform is built first and fed into the
  // user's runtime layer (so a Service/Command layer may require Environment,
  // C14), while staying in the final context so Capability.resolve also works
  // directly through `RunningApplication.runtime`. Both are provided to the
  // application-owned runtime scope, so the platform is acquired first and
  // released last (C15, I31).
  //
  // `Effect.exit` rather than a plain failure so the status Ref records
  // `Failed` before the error escapes — callers observing status after a failed
  // `start` must not see a stale `Initializing`.
  Effect.bind("runtime", ({ platform, statusRef }): Effect.Effect<Runtime.NexusRuntime<R | Capability.EnvironmentShape | EventBusShape>, ApplicationInitError, Scope.Scope> =>
    Effect.exit(Runtime.make(Layer.provideMerge(app.definition.runtime, platform), options?.shutdown === undefined ? undefined : { shutdown: options.shutdown })).pipe(Effect.andThen((exit) => {
      if (Exit.isFailure(exit)) {
        const error: ApplicationInitError = { _tag: "ServiceGraphFailed", cause: exit.cause };

        return Ref.set(statusRef, { _tag: "Failed", error }).pipe(Effect.andThen(Effect.fail(error)));
      }

      return Effect.succeed(exit.value);
    }))
  ),
  // The environment the platform built (D30), read from the built context.
  // Runtime.make always registers its handle; a missing record is a defect, never an empty environment.
  Effect.bind("environment", ({ runtime }): Effect.Effect<Capability.EnvironmentShape> => {
    const record = recordOf(runtime);

    return record === undefined
      ? Effect.die(refusal("not-a-runtime"))
      : Effect.succeed(Context.get(record.runtime.context as Context.Context<Capability.EnvironmentShape>, Capability.Environment));
  }),
  Effect.tap(({ statusRef }) => Ref.set(statusRef, { _tag: "Running" })),
  // The application's lifecycle is its runtime's (N2). The runtime's termination
  // runs these hooks, whichever route triggers it: `Stopping` atomically with the
  // end of admission, `Stopped` once everything is released. Route 2 is the
  // runtime's own finalizer on the caller's start scope; route 1 is
  // Application.shutdown. Both are the same single, claimed termination.
  Effect.tap(({ statusRef, runtime }) => Effect.sync(() => setHooks(runtime, {
    onBegin: Ref.update(statusRef, (current): ApplicationStatus => current._tag === "Running" ? { _tag: "Stopping" } : current),
    onEnd: Ref.set(statusRef, { _tag: "Stopped" }),
  }))),
  Effect.let("record", ({ statusRef, runtime }): AppRecord => ({ statusRef, runtime })),
  Effect.map(({ statusRef, runtime, environment, record }): RunningApplication<R> => {
    const running: RunningApplication<R> = Object.freeze({ status: Ref.get(statusRef), runtime, environment });

    apps.set(running, record);

    return running;
  })
);

// Route 1. Idempotent, and never fails: every call returns once the status is `Stopped`.
export const shutdown = <R>(running: RunningApplication<R>, options?: Runtime.ShutdownOptions): Effect.Effect<void> => {
  const record = apps.get(running);

  return record === undefined
    ? Effect.die(refusal("not-an-application"))
    : terminate(record.runtime, options?.grace === undefined ? undefined : Duration.decode(options.grace));
};

export const status = <R>(running: RunningApplication<R>): Effect.Effect<ApplicationStatus> => running.status;

/**
 * Application-owned State (D1): created in the application runtime's own scope,
 * so it ends with the application. The caller supplies no Scope.
 *
 * Admitted only while the application is `Running` (Q2 = A). Construction is
 * ordered against the start of termination: it either completes first, and the
 * State then ends with the application, or it is refused as a defect. The error
 * channel is exactly StateInitError; there is no lifecycle error type.
 */
export const createState = <R, A>(running: RunningApplication<R>, schema: Schema.Schema<A>, initial: A): Effect.Effect<StateHandle<A>, StateInitError> => {
  const scope = windingScopeOf(running.runtime);

  return scope === undefined || !apps.has(running)
    ? Effect.die(refusal("not-an-application"))
    : admit(running.runtime, Scope.extend(State.create(schema, initial), scope));
};
