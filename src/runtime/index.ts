import { Context, Effect, Exit, Fiber, Layer, Runtime as EffectRuntime, Scope } from "effect";
import { EventBusLive } from "../event/index.js";

export interface NexusRuntime<R> {
  readonly context: Context.Context<R>;
  readonly scope: Scope.CloseableScope;
  readonly runtime: EffectRuntime.Runtime<R>;
}

export type RuntimeInitError = {
  readonly _tag: "LayerBuildFailed";
  readonly cause: unknown;
};

export const make = <R>(
  layer: Layer.Layer<R, unknown, never>
): Effect.Effect<NexusRuntime<R>, RuntimeInitError, Scope.Scope> =>
  Effect.gen(function* () {
    const runtimeScope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.succeed(undefined)));

    const merged = Layer.merge(layer, EventBusLive) as Layer.Layer<R, unknown, never>;
    const context = yield* Layer.buildWithScope(merged, runtimeScope).pipe(
      Effect.mapError((cause): RuntimeInitError => ({ _tag: "LayerBuildFailed", cause }))
    );
    const runtime = yield* Effect.runtime<R>().pipe(Effect.provide(context));

    return { context, scope: runtimeScope, runtime };
  });

export const run = <R, A, E>(nexusRuntime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A> =>
  EffectRuntime.runPromise(nexusRuntime.runtime)(effect);

export const runFork = <R, A, E>(
  nexusRuntime: NexusRuntime<R>,
  effect: Effect.Effect<A, E, R>
): Fiber.RuntimeFiber<A, E> => EffectRuntime.runFork(nexusRuntime.runtime)(effect);

export const shutdown = <R>(nexusRuntime: NexusRuntime<R>): Effect.Effect<void> =>
  Scope.close(nexusRuntime.scope, Exit.succeed(undefined));
