# Resource

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §11. A `Resource` is a
long-lived external resource requiring acquisition and release
(WebSocket, DB connection, camera, worker, file handle, ...). It is never
an `Application`-level managed object (§4) — it's acquired inside whichever
`Service` implementation or `Command` effect needs it, scoped to
`Runtime`'s application `Scope` (§5).

## Responsibility

- Guarantee `acquire → use → release` even when the using effect fails,
  is interrupted, or the whole application shuts down mid-use.
- Give `Service` implementations and `Command` handlers one consistent way
  to hold a resource, instead of every integration reinventing cleanup.

## Data Model

`Resource` has no data model of its own beyond what it wraps — it is a
direct, named application of Effect's `Scope`, not a new lifecycle state
machine:

```ts
interface ResourceOptions<A, E, R> {
  readonly acquire: Effect.Effect<A, E, R>;
  readonly release: (a: A) => Effect.Effect<void>;
}
```

## API

```ts
namespace Resource {
  function acquire<A, E, R>(
    options: ResourceOptions<A, E, R>
  ): Effect.Effect<A, E, R | Scope.Scope>;
}
```

That's the entire API. `Resource.acquire` is `Effect.acquireRelease` under
a NEXUS-facing name — §11 is explicit that custom lifecycle management is
out of scope where `Scope` already provides the semantics needed, and this
primitive exists purely so `Service`/`Command` code reaches for one
NEXUS-documented name instead of half using `Effect.acquireRelease`
directly and half inventing something bespoke.

## Errors

`Resource.acquire`'s error channel is exactly `E` — whatever `acquire`
itself can fail with. `release` is required to be infallible
(`Effect.Effect<void>`, no error channel) — a `Resource` that needs to
report a release failure should log it internally rather than propagate
it, since by the time `release` runs there is usually no meaningful
caller left to hand an error to (shutdown, interruption, or a sibling
failure already unwinding).

## Rules

- `acquire` must run in a `Scope` — never called bare at `Application`
  startup and held for the process lifetime "by convention"; the owning
  `Scope` (a `Command`'s own scope, or the `Runtime`'s application scope
  for something intentionally application-lifetime) is what makes release
  automatic and interruption-safe.
- `release` must run on every exit path: success, typed failure,
  interruption, and defect — this is what "must occur even when commands
  fail... an effect is interrupted... initialization partially fails" (§11)
  means concretely, and it's what `Scope`/`acquireRelease` already
  guarantee, which is the reason not to hand-rolled it.
- A `Resource` must not be reached for when a `Service` would do — if
  "acquire" just means "construct a stateless client," that's a `Service`
  implementation, not a `Resource`; `Resource` is specifically for things
  with a release step that matters.

## Example

```ts
const withUserSocket = Resource.acquire({
  acquire: Effect.tryPromise({
    try: () => connectSocket(userId),
    catch: (cause) => ({ _tag: "SocketConnectError", cause }) as const,
  }),
  release: (socket) => Effect.sync(() => socket.close()),
});

const listenForUpdates = Effect.gen(function* () {
  const socket = yield* withUserSocket;
  yield* Stream.runForEach(socket.messages, handleMessage);
});
```

## Testing

Covers §20 "Resource": acquisition (the happy path), usage, release
(release always runs after use completes), and interruption cleanup
(release still runs if the using fiber is interrupted mid-use, and if
`Application.shutdown` fires while the resource is held).
