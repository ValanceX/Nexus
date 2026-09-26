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

interface EventBusShape {
  readonly publish: (envelope: Envelope) => Effect.Effect<void>;
  readonly subscribe: Effect.Effect<Queue.Dequeue<Envelope>, never, Scope.Scope>;
}

const EventBusLive: Layer.Layer<EventBusShape>;
```

`EventDef.schema` **describes the payload**: it is the payload's contract,
and it is available for runtime validation or serialization wherever events
cross a boundary that needs it (persistence, synchronization, or a consumer
receiving events from an untyped source). `publish` doesn't use it.

`EventBusShape` is the bus service's type. It's exported so a layer can
name the bus as a requirement (`Layer.Layer<R, E, EventBusShape>`); its
members are plumbing. Code publishes and subscribes through `Event.publish`
and `Event.subscribe`.

The bus is deliberately small and scoped — one per runtime (built alongside
it, closed with it), not a process-global singleton. There is exactly one
bus per running application; there is no API for creating additional
independent buses until a concrete need for that appears (§12, §2.1).
`EventBusLive` is a standalone bus that closes with its layer's scope.

## API

```ts
namespace Event {
  function define<Tag extends string, Payload>(tag: Tag, schema: Schema.Schema<Payload>): EventDef<Tag, Payload>;
  function publish<Tag extends string, Payload>(event: EventDef<Tag, Payload>, payload: Payload): Effect.Effect<void, never, EventBusShape>;
  function subscribe<Tag extends string, Payload>(event: EventDef<Tag, Payload>): Stream.Stream<Payload, never, EventBusShape>;
}
```

`publish`/`subscribe` take the bus from context (via `Effect`'s `R`
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

- Events are typed and immutable. **`publish` is type-directed:** it accepts
  a `Payload` typed by its `EventDef`, and performs no runtime decode or
  validation. Runtime validation isn't part of the Event contract. A payload
  that gets past the type system through an untyped escape hatch (a cast,
  untyped JavaScript) is the publisher's responsibility, and is delivered as
  given.
- This follows NEXUS's boundary principle: data is validated where it
  *enters* from an untrusted source. `Command.invoke` takes `unknown` and
  decodes it; publication is internal, emitted by commands and services
  from data already validated where it entered. A boundary that does need
  runtime validation (for example, events arriving from persistence)
  validates with `EventDef.schema` itself.
- `Command`s emit events as a side effect of handling intent; `Event`
  itself never originates a `Command` invocation — that would blur the
  intent/fact distinction §12 draws.
- No global, ambient event bus lookup — the bus only reaches code that
  has it in its `R` context, same discipline as any other NEXUS service
  (§6's "must not become a global service locator," which §5 also holds
  `Runtime` to).
- Do not add wildcard subscriptions, event replay, or persistence-backed
  event logs to the first implementation — those are exactly the "giant
  global event bus" §12 warns against building up front.

## Lifecycle

- **A bus closes when its owner terminates.** For a runtime (and so an
  application), the bus closes when termination begins, *before* any other
  resource is released. From then on, no event is delivered to any
  subscription, and every existing `Event.subscribe` stream ends normally
  (it emits nothing further and signals its end). An event a subscriber is
  already handling may finish; events still queued for it are discarded,
  never handed over after the close. (A subscription takes one event at a
  time, only when its subscriber asks for the next.)
- **Publishing keeps working.** `publish` never fails: an effect still
  running after the bus has closed can publish, and the event reaches no
  subscriber, as a publish with no subscribers always has.
- **A subscription opened after the bus has closed** ends immediately, with
  no events.
- New work run through a terminating runtime (including a new `publish`) is
  refused by the runtime itself (see [runtime.md](./runtime.md)).

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

Covers §20 "Event": typed event creation (an `EventDef`'s schema describes
its payload and can validate one), publication (a `Command` that publishes
actually reaches the bus, and `publish` performs no runtime validation),
consumption (a subscriber's `Stream` receives published events, in order),
and lifecycle behavior (the bus closes with its owner: every subscription
ends normally, nothing is delivered after, and publishing still succeeds).
