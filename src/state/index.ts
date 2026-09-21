import { Effect, Schema, Scope, Stream, SubscriptionRef } from "effect";

export interface StateHandle<A> {
  readonly get: Effect.Effect<A>;
  readonly update: <E = never>(f: (current: A) => Effect.Effect<A, E>) => Effect.Effect<A, E>;
  readonly set: (next: A) => Effect.Effect<A, StateValidationError>;
  readonly changes: Stream.Stream<A>;
}

export type StateInitError = {
  readonly _tag: "InitialValueInvalid";
  readonly issues: ReadonlyArray<string>;
};

export type StateValidationError = {
  readonly _tag: "StateValidationFailed";
  readonly issues: ReadonlyArray<string>;
};

export const create = <A>(
  schema: Schema.Schema<A>,
  initial: A
): Effect.Effect<StateHandle<A>, StateInitError, Scope.Scope> =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknown(schema)(initial).pipe(
      Effect.mapError((error): StateInitError => ({
        _tag: "InitialValueInvalid",
        issues: [String(error)],
      }))
    );

    const ref = yield* SubscriptionRef.make(decoded);

    const set = (next: A): Effect.Effect<A, StateValidationError> =>
      Schema.decodeUnknown(schema)(next).pipe(
        Effect.mapError((error): StateValidationError => ({
          _tag: "StateValidationFailed",
          issues: [String(error)],
        })),
        Effect.tap((validated) => SubscriptionRef.set(ref, validated)),
      );

    const update = <E = never>(f: (current: A) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(ref);
        const next = yield* f(current);
        yield* SubscriptionRef.set(ref, next);
        return next;
      });

    return {
      get: SubscriptionRef.get(ref),
      update,
      set,
      changes: Stream.drop(ref.changes, 1),
    };
  });

export const get = <A>(state: StateHandle<A>): Effect.Effect<A> => state.get;

export const update = <A, E = never>(
  state: StateHandle<A>,
  f: (current: A) => Effect.Effect<A, E>
): Effect.Effect<A, E> => state.update(f);

export const set = <A>(state: StateHandle<A>, next: A): Effect.Effect<A, StateValidationError> =>
  state.set(next);
