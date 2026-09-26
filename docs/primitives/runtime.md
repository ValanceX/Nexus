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
interface NexusRuntime<in R> {
  // opaque: no readable members
}
```

A `NexusRuntime<R>` is an **opaque execution handle**. It has no readable
member, and nothing reachable from it is the Effect `Runtime` that executes
effects, the service `Context`, or the runtime's `Scope`. Those stay private
to NEXUS (N3). A caller holds the handle and passes it to `Runtime.run` and
`Runtime.runFork`, which is the only way effects reach the service graph.
Services reach an effect only through its declared `R`.

There are two kinds of runtime behind the one handle type, and they differ
only in who owns them:

- **An application runtime** is `RunningApplication.runtime`. The
  application owns it. Callers can't shut it down: it ends only through the
  application's lifecycle (see [application.md](./application.md)).
- **A standalone runtime** is what `Runtime.make` returns. The caller's
  `Scope` owns it, and it ends when that `Scope` closes.

## API

```ts
namespace Runtime {
  function make<R>(layer: Layer.Layer<R, unknown, EventBusShape>): Effect.Effect<NexusRuntime<R | EventBusShape>, RuntimeInitError, Scope.Scope>;
  function run<R, A, E>(runtime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Promise<A>;
  function runFork<R, A, E>(runtime: NexusRuntime<R>, effect: Effect.Effect<A, E, R>): Fiber.RuntimeFiber<A, E>;
}
```

`make` builds the service graph from `layer`, with the runtime's own event
bus as an ambient layer: the bus satisfies an `EventBusShape` requirement
`layer` declares, and stays in the built context, so `Event.publish` and
`Event.subscribe` work through `run`/`runFork`.

`run` surfaces a `Promise` deliberately — it is the boundary NEXUS hands to
non-Effect callers (a MESH host running an adapter `dispatch` that invokes
a command, a test calling into the application). `runFork` is for callers
that need a `Fiber` handle back, e.g. to interrupt a long-running command.

There is no `shutdown`. A runtime ends when its owner ends it: the caller's
`Scope`, for a standalone runtime; the application's lifecycle, for an
application runtime.

## Errors

```ts
type RuntimeInitError = {
  readonly _tag: "LayerBuildFailed";
  readonly cause: unknown
};
```

`run`/`runFork` introduce no runtime-level error channel of their own. For
Effect callers (`runFork`'s fiber, or an effect composed around `run`),
failures surface as whatever `E` the given effect already carries;
`Runtime` doesn't swallow or rewrap command/service errors.

`run`'s `Promise` rejects with Effect's failure wrapper, not the bare `E`.
A non-Effect caller that needs the typed `E` runs `Effect.exit` inside
`run` and inspects the `Exit`. This is a known limitation; NEXUS has no
separate non-Effect API.

**Refusal.** Once a runtime's termination has been requested (for an
application runtime, by `Application.shutdown` or by closing the caller's
start scope; for a standalone runtime, when its owning `Scope` starts
closing), `run` and `runFork` don't start the effect: the call ends as a defect, with no typed failure.
`run`'s `Promise` rejects, and `runFork`'s fiber exits with a die. A handle
NEXUS didn't make is refused the same way.

## Rules

- `Runtime.make` must fully build the service graph (`Layer` to
  `Context`) before returning — a `NexusRuntime` is only ever "ready," it
  is never in a partially-initialized state a caller could observe.
- **Termination happens once, in this order:** the request ends admission
  at once, for `run`, `runFork` and application-owned `State` alike; wait
  for work already admitted (such as an application-owned `State` being
  created) to finish; begin (for an application, it enters `Stopping`);
  close the runtime's event bus, so no event is delivered after this point
  and every subscription ends normally; then close the runtime's `Scope`,
  which releases every `Resource` (§11) acquired anywhere in that runtime,
  including by commands that already completed. A termination that has
  begun always completes.
- Effects already running when termination begins are not interrupted by
  it; only new work is refused.
- `Runtime` must never expose the Effect `Runtime`, the service `Context`
  or its `Scope` — no ambient lookup outside `Service`/`Capability`
  resolution. See §5's "must not become a global service locator."

## Example

```ts
const program = Effect.scoped(Effect.Do.pipe(
  Effect.bind("runtime", () => Runtime.make(UserRepositoryLive)),
  Effect.tap(({ runtime }) => Effect.promise(() =>
    Runtime.run(runtime, Command.invoke(selectUser, { userId }))
  ))
));
// The runtime ends, releasing its resources, when `Effect.scoped`'s scope closes.
```

## Testing

Covers §20 "Runtime": effect execution, cancellation (interrupting a fiber
from `runFork` actually stops work), scope lifetime, termination order,
refusal after termination, the opaque handle, and resource cleanup on both
normal completion and interruption.
