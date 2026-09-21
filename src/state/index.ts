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

export const create = <A>(schema: Schema.Schema<A>, initial: A): Effect.Effect<StateHandle<A>, StateInitError, Scope.Scope> => Effect.Do.pipe(
  Effect.andThen(Schema.decodeUnknown(schema)(initial)),
  Effect.mapError((error): StateInitError => ({
    _tag: "InitialValueInvalid",
    issues: [String(error)],
  })),
  Effect.andThen(SubscriptionRef.make),
  Effect.map((ref) => ({
    get: SubscriptionRef.get(ref),
    // Atomic read-modify-write: SubscriptionRef.updateAndGetEffect runs the
    // transition under the ref's semaphore, so two concurrent fibers cannot both
    // read the same `current` and lose one another's update.
    update: <E = never>(f: (current: A) => Effect.Effect<A, E>): Effect.Effect<A, E> => SubscriptionRef.updateAndGetEffect(ref, f),
    set: (next: A): Effect.Effect<A, StateValidationError> => Effect.Do.pipe(
      Effect.andThen(Schema.decodeUnknown(schema)(next)),
      Effect.mapError((error): StateValidationError => ({
        _tag: "StateValidationFailed",
        issues: [String(error)],
      })),
      Effect.tap((validated) => SubscriptionRef.set(ref, validated)),
    ),
    // Dropped because SubscriptionRef.changes replays the current value on
    // subscribe, and `changes` is specified as future commits only.
    changes: Stream.drop(ref.changes, 1),
  }))
);

export const get = <A>(state: StateHandle<A>): Effect.Effect<A> => state.get;

export const update = <A, E = never>(state: StateHandle<A>, f: (current: A) => Effect.Effect<A, E>): Effect.Effect<A, E> => state.update(f);

export const set = <A>(state: StateHandle<A>, next: A): Effect.Effect<A, StateValidationError> => state.set(next);
