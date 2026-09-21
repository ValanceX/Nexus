import { Effect, Layer, Ref, Scope } from "effect";
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

export interface ApplicationDefinition<R> {
  readonly name: string;
  readonly runtime: Layer.Layer<R, unknown, never>;
  readonly environment?: ReadonlyMap<string, Capability.CapabilityResolution<unknown>>;
}

export interface Application<R> {
  readonly definition: ApplicationDefinition<R>;
}

export interface RunningApplication<R> {
  readonly status: Effect.Effect<ApplicationStatus>;
  readonly runtime: Runtime.NexusRuntime<R | Capability.EnvironmentShape>;
  readonly environment: Capability.EnvironmentShape;
  readonly statusRef: Ref.Ref<ApplicationStatus>;
}

export const define = <R>(definition: ApplicationDefinition<R>): Application<R> => ({ definition });

export const start = <R>(
  app: Application<R>
): Effect.Effect<RunningApplication<R>, ApplicationInitError, Scope.Scope> =>
  Effect.gen(function* () {
    const statusRef = yield* Ref.make<ApplicationStatus>({ _tag: "Created" });
    yield* Ref.set(statusRef, { _tag: "Initializing" });

    const resolutions = app.definition.environment ?? new Map<string, Capability.CapabilityResolution<unknown>>();
    const environment: Capability.EnvironmentShape = { resolutions };
    const environmentLayer = Capability.EnvironmentLive(resolutions);
    const fullLayer = Layer.merge(app.definition.runtime, environmentLayer) as Layer.Layer<
      R | Capability.EnvironmentShape,
      unknown,
      never
    >;

    const exit = yield* Effect.exit(Runtime.make(fullLayer));
    if (exit._tag === "Failure") {
      const error: ApplicationInitError = { _tag: "ServiceGraphFailed", cause: exit.cause };
      yield* Ref.set(statusRef, { _tag: "Failed", error });
      return yield* Effect.fail(error);
    }

    yield* Ref.set(statusRef, { _tag: "Running" });

    return {
      status: Ref.get(statusRef),
      runtime: exit.value,
      environment,
      statusRef,
    };
  });

export const shutdown = <R>(running: RunningApplication<R>): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Ref.set(running.statusRef, { _tag: "Stopping" });
    yield* Runtime.shutdown(running.runtime);
    yield* Ref.set(running.statusRef, { _tag: "Stopped" });
  });

export const status = <R>(running: RunningApplication<R>): Effect.Effect<ApplicationStatus> => running.status;
