# Service

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §6. A `Service` is a typed
application dependency — an interface, not an implementation.
Infrastructure provides implementations as `Layer`s.

## Responsibility

- Describe a typed contract (`UserRepository`, `Clock`, `Logger`, ...).
- Let infrastructure swap implementations (`HttpUserRepository` vs.
  `InMemoryUserRepository`) without callers knowing.
- Compose via Effect `Context`/`Layer` — NEXUS adds naming/discoverability
  conventions on top, not a second dependency-injection mechanism (§2.2).

## Data Model

A `Service<Shape>` is exactly an Effect `Context.Tag<Shape, Shape>` — NEXUS
does not wrap it in additional runtime machinery. The value in defining it
through `Service.define` rather than calling `Context.GenericTag` directly
is a consistent naming/discovery convention across the codebase (every tag
lives in `src/service/`, is findable, and is what §15's MESH-facing API
introspects to know which services exist).

```ts
type Service<Shape> = Context.Tag<Shape, Shape>;
```

## API

```ts
namespace Service {
  function define<Shape>(name: string): Service<Shape>;
  function layer<Shape, R = never, E = never>(service: Service<Shape>, implementation: Effect.Effect<Shape, E, R>): Layer.Layer<Shape, E, R>;
  function layerSync<Shape>(service: Service<Shape>, implementation: () => Shape): Layer.Layer<Shape>;
}
```

`Service.layer`/`layerSync` are thin conveniences over `Layer.effect` /
`Layer.sync` scoped to the tag `Service.define` produced — they exist so
service implementations are written the same way everywhere rather than
every infrastructure module reaching for a different `Layer` constructor.

## Errors

`Service` itself introduces no error type. A service's *methods* carry
whatever typed errors are appropriate to that contract (see §6's
`UserRepository.getUser` example returning
`Effect.Effect<User, UserNotFoundError>`); `Service.define`/`layer` do not
add a wrapping error channel.

The one failure that is NEXUS's concern rather than the service
contract's: a missing `Layer` for a required service. That surfaces as
Effect's own `Layer`-composition error when `Runtime.make` (see
[runtime.md](./runtime.md)) builds the graph — NEXUS does not reimplement
that check.

## Rules

- A service interface must not depend on UI rendering and must not inspect
  renderer-specific state (§6).
- A service may depend on other services (constructor-style, via `Layer`
  composition) — cyclic dependencies are an `Layer` build failure, not a
  NEXUS-specific error.
- Prefer one `Service.define` per capability-of-the-application-domain
  (`UserRepository`), not one per infrastructure detail (`HttpClient`
  belongs inside `HttpUserRepository`'s implementation, not as a separate
  service every use case depends on) — keeps the service surface aligned
  with §2.1's "application semantics over framework abstractions."

## Example

```ts
interface UserRepositoryShape {
  readonly getUser: (id: UserId) => Effect.Effect<User, UserNotFoundError>;
}

const UserRepository = Service.define<UserRepositoryShape>("UserRepository");

const UserRepositoryLive = Service.layer(
  UserRepository,
  Effect.gen(function* () {
    const http = yield* HttpClient;

    return {
      getUser: (id) => http.get(`/users/${id}`).pipe(
        Effect.mapError(() => ({ _tag: "UserNotFoundError", id }) as const)
      ),
    };
  })
);
```

## Testing

Covers §20 "Service": typed dependency resolution (a consumer using
`yield* UserRepository` gets the right shape), `Layer` composition
(multiple services combining into one graph), and missing-dependency
failures (a `Layer.effect` that depends on an unprovided tag fails the
graph build, not silently returning `undefined`).
