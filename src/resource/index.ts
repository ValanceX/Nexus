import { Effect, Scope } from "effect";

export interface ResourceOptions<A, E, R> {
  readonly acquire: Effect.Effect<A, E, R>;
  readonly release: (a: A) => Effect.Effect<void>;
}

export const acquire = <A, E, R>(options: ResourceOptions<A, E, R>): Effect.Effect<A, E, R | Scope.Scope> => Effect.acquireRelease(
  options.acquire,
  options.release
);
