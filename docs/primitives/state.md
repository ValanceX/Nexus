# State

> **In plain terms:** Data your app owns. You can read it and watch it change, but you only change it through explicit updates. Its initial value and every `set` are validated against its schema.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §7. `State` is
application-owned mutable state: a current immutable value, controlled
transitions, and observation. It is deliberately not "just a `Ref`" — see
Rules below for what that means concretely.

## Responsibility

- Hold application (domain) state — never UI state, which belongs to the
  component/UI runtime, not NEXUS (§7, root architecture doc's state
  model).
- Make every transition explicit: `(previous, action) => next`, never
  arbitrary mutation.
- Expose observation so `Selector` (and eventually MESH) can react to
  changes without polling.
- Validate shape via Schema at creation and, optionally, at every update.

## Data Model

```ts
interface StateHandle<A> {
  readonly get: Effect.Effect<A>;
  readonly update: <E = never>(f: (current: A) => Effect.Effect<A, E>) => Effect.Effect<A, E>;
  readonly set: (next: A) => Effect.Effect<A, StateValidationError>;
  readonly changes: Stream.Stream<A>;
}
```

`update` takes an effectful transition (not just a pure `(A) => A`)
because some legitimate transitions need to run a Schema decode/validate
step or read from another `StateHandle` — but the common case is
`State.update(users, (s) => Effect.succeed({ ...s, loading: true }))`,
which reads exactly like the pure form. `changes` is a `Stream`, not a
callback-registration API, so subscribing composes with the rest of
Effect (`Stream.runForEach`, `Stream.take`, etc.) instead of introducing a
second, bespoke subscription mechanism.

## API

```ts
namespace State {
  function create<A>(schema: Schema.Schema<A>, initial: A): Effect.Effect<StateHandle<A>, StateInitError, Scope.Scope>;
  function update<A, E = never>(state: StateHandle<A>, f: (current: A) => Effect.Effect<A, E>): Effect.Effect<A, E>;
  function set<A>(state: StateHandle<A>, next: A): Effect.Effect<A, StateValidationError>;
  function get<A>(state: StateHandle<A>): Effect.Effect<A>;
}
```

`create` is scoped: a `StateHandle` lives as long as the `Scope` it was
created in. While that scope is open, `changes` stays open. When the scope
closes, every `changes` subscriber, and every stream derived from it such as
`Selector.changes`, completes normally, without an error, so state does not
outlive the scope that owns it. A subscription started after the scope has
closed completes immediately.

`create` is for state its caller owns. For state the **application** owns,
use `Application.createState(running, schema, initial)` (see
[application.md](./application.md)): it lives in the application runtime's
own scope, needs no `Scope` from the caller, and its `changes` end when the
application stops, by either of its termination routes.

## Errors

```ts
type StateInitError = {
  readonly _tag: "InitialValueInvalid";
  readonly issues: ReadonlyArray<string>
};

type StateValidationError = {
  readonly _tag: "StateValidationFailed";
  readonly issues: ReadonlyArray<string>
};
```

`issues` are human-readable messages describing why the value failed its
schema.

`State.set` runs the value through `schema` before committing — an
invalid `next` never reaches `changes` or a subsequent `get`.
`State.update`'s `f` is trusted to produce a schema-valid `A` (it typically
starts from an already-valid `current`); if a use case needs external,
untrusted input validated on the way in, that validation belongs in the
`Command`'s input schema (see [command.md](./command.md)), not repeated in
every `State.update` call.

## Rules

- `State` must never be exposed as a raw Effect `Ref`/mutable object to
  code outside `nexus` — the only surface is `StateHandle<A>` (§7's "NEXUS
  State is an application-level semantic abstraction," not a `Ref`
  wrapper).
- `get`/`update`/`set` are the entire mutation surface; there is no way to
  mutate `A` in place.
- `changes` must emit the *new* value only after `update`/`set` has fully
  committed (schema-valid, observers see a consistent value), never an
  intermediate one.
- MESH never reads or writes `State`. The MESH adapter renders a
  `Selector`'s value as a snapshot, and state changes only through a
  `Command` that an explicit adapter binding invokes. See
  [ARCHITECTURE.md §15](../ARCHITECTURE.md#15-mesh-host-adapter).

## Example

```ts
const UserState = Schema.Struct({
  users: Schema.Array(User),
  selectedUser: Schema.OptionFromNullOr(UserId),
  loading: Schema.Boolean,
});

const program = Effect.gen(function* () {
  const users = yield* State.create(UserState, {
    users: [],
    selectedUser: Option.none(),
    loading: false,
  });

  yield* State.update(users, (s) => Effect.succeed({ ...s, loading: true }));
});
```

## Testing

Covers §20 "State": initialization (including `StateInitError` on an
invalid initial value), transitions (`update`/`set` produce the expected
next value), immutability (the previous value handed to `update` is never
mutated), and observation (`changes` emits exactly once per commit, in
order).
