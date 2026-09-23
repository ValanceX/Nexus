# Event

> **In plain terms:** "This happened." A typed, immutable fact that other parts of the app can listen for. Commands express what should happen, and events record what did.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §12. An `Event` represents
something that happened — a fact, as opposed to a `Command`'s expressed
intent. Like `Resource`, it is not an `Application`-level managed object
(§4); it's published by whichever `Command` or `Service` effect produces
it. §12 is explicit: start with the smallest event mechanism necessary, not
a global event bus.

## Responsibility

- Let a `Command`/`Service` announce a fact (`"User selection changed"`)
  without knowing or caring who, if anyone, is listening.
- Give consumers (analytics, persistence, synchronization, debugging,
  future plugin systems) a typed, immutable record of what happened.

## Data Model

```ts
interface EventDef<Tag extends string, Payload> {
  readonly _tag: Tag;
  readonly schema: Schema.Schema<Payload>;
}

interface EventBus {
  readonly publish: <Tag extends string, Payload>(event: EventDef<Tag, Payload>, payload: Payload) => Effect.Effect<void>;
  readonly subscribe: <Tag extends string, Payload>(event: EventDef<Tag, Payload>) => Stream.Stream<Payload>;
}
```

`EventBus` is deliberately small and scoped — one per `Application`
(built alongside `Runtime`, released with it), not a process-global
singleton. There is exactly one bus per running application; there is no
API for creating additional independent buses until a concrete need for
that appears (§12, §2.1).

## API

```ts
namespace Event {
  function define<Tag extends string, Payload>(tag: Tag, schema: Schema.Schema<Payload>): EventDef<Tag, Payload>;
  function publish<Tag extends string, Payload>(event: EventDef<Tag, Payload>, payload: Payload): Effect.Effect<void, never, EventBus>;
  function subscribe<Tag extends string, Payload>(event: EventDef<Tag, Payload>): Stream.Stream<Payload, never, EventBus>;
}
```

`publish`/`subscribe` take `EventBus` from context (via `Effect`'s `R`
channel) rather than an explicit bus argument, so a `Command` handler
publishing an event reads the same way as any other NEXUS effect (`yield*
Event.publish(...)`) instead of needing a bus reference threaded through
every function signature.

## Errors

None. Publishing is fire-and-forget from the publisher's perspective —
`publish`'s error channel is `never`. If a specific subscriber's handling
of an event can fail, that failure belongs to the subscriber's own effect
(e.g. a persistence subscriber that fails to write should handle/retry/log
that itself), not to `publish`.

## Rules

- Events are typed and immutable — `EventDef`'s `schema` exists so a
  malformed `payload` cannot be published (`publish` should decode-check
  in development/test builds at minimum).
- `Command`s emit events as a side effect of handling intent; `Event`
  itself never originates a `Command` invocation — that would blur the
  intent/fact distinction §12 draws.
- No global, ambient event bus lookup — `EventBus` only reaches code that
  has it in its `R` context, same discipline as any other NEXUS service
  (§6's "must not become a global service locator," which §5 also holds
  `Runtime` to).
- Do not add wildcard subscriptions, event replay, or persistence-backed
  event logs to the first implementation — those are exactly the "giant
  global event bus" §12 warns against building up front.

## Example

```ts
const UserSelected = Event.define(
  "UserSelected",
  Schema.Struct({ userId: UserId })
);

const selectUser = Command.define(
  "users.select",
  Schema.Struct({ userId: UserId }),
  ({ userId }) => Effect.gen(function* () {
    yield* State.update(usersState, (s) => Effect.succeed({ ...s, selectedUser: Option.some(userId) }));
    yield* Event.publish(UserSelected, { userId });
  })
);
```

## Testing

Covers §20 "Event": typed event creation (schema rejects a malformed
payload), publication (a `Command` that publishes actually reaches the
bus), consumption (a subscriber's `Stream` receives published events, in
order), and lifecycle behavior (the bus, and therefore all subscriptions,
completes when the owning `Application`'s scope closes).
