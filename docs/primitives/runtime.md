# Runtime

> **In plain terms:** The engine room. It runs your effects, keeps track of which services exist, and makes sure everything that was opened gets closed when the app stops.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §5. `Runtime` is the
execution boundary: it owns Effect execution, the application `Scope`, the
service dependency graph, lifecycle, cancellation, resource cleanup, and
fatal error handling. It does **not** own `Environment` (§5, §14) — that's
a sibling under `Application`, so capability resolution can proceed and
fail independently of whether the effect runtime has started.

## Responsibility

- Build the service graph from the `Layer` an `Application` was defined
  with.
- Execute commands and other application effects inside a controlled
  environment.
- Provide cancellation and structured shutdown.
- Guarantee resource cleanup on interruption, not just on success.

## Data Model

```ts
interface NexusRuntime<R> {
  readonly context: Effect.Effect<Context.Context<R>>;
  readonly scope: Scope.Scope;
}
```

`NexusRuntime<R>` is a thin wrapper around Effect's own `ManagedRuntime` /
`Runtime.Runtime<R>` plus the `Scope` the service graph was built in. It
does not add scheduling or execution semantics beyond what Effect already
provides (§2.2) — it exists so `Command`/`State`/`Capability` APIs have one
consistent thing to run effects against, instead of every primitive taking
raw `Layer`s and building its own runtime.

## API

```ts
namespace Runtime {
  function make<R>(layer: Layer.Layer<R, unknown, never>): Effect.Effect<NexusRuntime<R>, RuntimeInitError, Scope.Scope>;
  function run<R, A, E>(runtime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A>;
  function runFork<R, A, E>(runtime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E>;
  function shutdown(runtime: NexusRuntime<unknown>): Effect.Effect<void>;
}
```

`run` surfaces a `Promise` deliberately — it is the boundary NEXUS hands to
non-Effect callers (a MESH host running an adapter `dispatch` that invokes
a command, a test calling into the application). `runFork` is for callers that need a
`Fiber` handle back, e.g. to interrupt a long-running command.

## Errors

```ts
type RuntimeInitError = {
  readonly _tag: "LayerBuildFailed";
  readonly cause: unknown
};
```

`Runtime.run`/`runFork` do not introduce a runtime-level error channel of
their own — failures surface as whatever `E` the given effect already
carries. `Runtime` does not swallow or rewrap command/service errors.

## Rules

- `Runtime.make` must fully build the service graph (`Layer` to
  `Context`) before returning — a `NexusRuntime` is only ever "ready," it
  is never in a partially-initialized state a caller could observe.
- `shutdown` closes the `Scope`, which must trigger every `Resource`
  release (§11) acquired anywhere in that runtime, including ones acquired
  by commands that already completed.
- `Runtime` must never expose the raw `Context.Context` for ambient lookup
  outside `Service`/`Capability` resolution — see §5's "must not become a
  global service locator."

## Example

```ts
const program = Effect.gen(function* () {
  const runtime = yield* Runtime.make(UserRepositoryLive);
  const result = yield* Effect.promise(() =>
    Runtime.run(runtime, selectUser.invoke({ userId }))
  );

  yield* Runtime.shutdown(runtime);
});
```

## Testing

Covers §20 "Runtime": effect execution, cancellation (interrupting a fiber
from `runFork` actually stops work), scope lifetime, shutdown, and resource
cleanup on both normal completion and interruption.
