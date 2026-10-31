import { Effect, PubSub, Schema, Scope, Stream, SubscriptionRef } from "effect";

export interface StateHandle<A> {
  readonly get: Effect.Effect<A>;
  readonly update: <E = never>(f: (current: A) => Effect.Effect<A, E>) => Effect.Effect<A, E>;
  readonly set: (next: A) => Effect.Effect<A, StateValidationError>;
  /** Future commits only: the current value is not emitted. */
  readonly changes: Stream.Stream<A>;
  /**
   * The value current at the moment of subscription, then every later commit, in order. Nothing is committed
   * between the first element and the subscription to the rest: the two are one atomic step, so an observer
   * that starts from `values` can never hold a value older than the state it is subscribed to.
   * Ends when the owning scope closes, like `changes`.
   */
  readonly values: Stream.Stream<A>;
}

export type StateInitError = {
  readonly _tag: "InitialValueInvalid";
  readonly issues: ReadonlyArray<string>;
};

export type StateValidationError = {
  readonly _tag: "StateValidationFailed";
  readonly issues: ReadonlyArray<string>;
};

export const create = <A>(schema: Schema.Codec<A>, initial: A): Effect.Effect<StateHandle<A>, StateInitError, Scope.Scope> => Effect.Do.pipe(
  Effect.andThen(Schema.decodeUnknownEffect(schema)(initial)),
  Effect.mapError((error): StateInitError => ({
    _tag: "InitialValueInvalid",
    issues: [String(error)],
  })),
  Effect.andThen((value) => SubscriptionRef.make(value)),
  Effect.bindTo("ref"),
  // The owning scope's finalizer shuts down the PubSub the ref publishes commits through: a subscriber's pull is then interrupted, which its stream reads as
  // the end, so every `changes` and `values` subscriber ends normally and state does not outlive the scope that owns it. Commits still update the value.
  // (Stream.interruptWhen would run the subscription in a fiber of its own, so it would no longer subscribe in the same step that reads the current value.)
  Effect.tap(({ ref }) => Effect.addFinalizer(() => PubSub.shutdown(ref.pubsub))),
  Effect.map(({ ref }) => ({
    get: SubscriptionRef.get(ref),
    // Atomic read-modify-write: SubscriptionRef.updateAndGetEffect runs the
    // transition under the ref's semaphore, so two concurrent fibers cannot both
    // read the same `current` and lose one another's update.
    update: <E = never>(f: (current: A) => Effect.Effect<A, E>): Effect.Effect<A, E> => SubscriptionRef.updateAndGetEffect(ref, f),
    set: (next: A): Effect.Effect<A, StateValidationError> => Effect.Do.pipe(
      Effect.andThen(Schema.decodeUnknownEffect(schema)(next)),
      Effect.mapError((error): StateValidationError => ({
        _tag: "StateValidationFailed",
        issues: [String(error)],
      })),
      Effect.tap((validated) => SubscriptionRef.set(ref, validated)),
    ),
    // Dropped because SubscriptionRef.changes replays the current value on
    // subscribe, and `changes` is specified as future commits only.
    changes: Stream.drop(SubscriptionRef.changes(ref), 1),
    // SubscriptionRef.changes subscribes to a PubSub that replays the last commit, in one synchronous step, so the current value and later commits arrive
    // with nothing between them; `changes` above throws that first element away, `values` keeps it. A subscription made after the scope closed is empty.
    values: SubscriptionRef.changes(ref),
  }))
);

export const get = <A>(state: StateHandle<A>): Effect.Effect<A> => state.get;

export const update = <A, E = never>(state: StateHandle<A>, f: (current: A) => Effect.Effect<A, E>): Effect.Effect<A, E> => state.update(f);

export const set = <A>(state: StateHandle<A>, next: A): Effect.Effect<A, StateValidationError> => state.set(next);
