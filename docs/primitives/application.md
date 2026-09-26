# Application

> **In plain terms:** The whole app in one value. You describe what it's made of, then `start` it and later `shutdown` it. Startup failures come back as typed errors instead of crashes, and shutdown always cleans up.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §4 for the ownership model
this belongs to. `Application` is the composition root: it owns exactly
`Runtime` and `Environment`, nothing else directly (§4, §14).

## Responsibility

- Define the application's composition (its service graph and its
  environment/capability configuration).
- Bootstrap dependencies and initialize state.
- Start `Runtime` and resolve `Environment` capabilities.
- Own the application's lifetime and its typed lifecycle.
- Shut down cleanly, releasing everything `Runtime` scoped.

## Data Model

```ts
type ApplicationStatus =
  | { readonly _tag: "Created" }
  | { readonly _tag: "Initializing" }
  | { readonly _tag: "Running" }
  | { readonly _tag: "Stopping" }
  | { readonly _tag: "Stopped" }
  | { readonly _tag: "Failed"; readonly error: ApplicationInitError };
```

An `Application<R>` is a *definition* — inert until started. Starting it
produces a `RunningApplication<R>`. Commands run through its `runtime`
(`Runtime.run(running.runtime, Command.invoke(…))`), and application-owned
state is created with `Application.createState`.

```ts
type ApplicationAmbient = EnvironmentShape | EventBusShape;

interface ApplicationDefinition<R> {
  readonly name: string;
  readonly runtime: Layer.Layer<R, unknown, ApplicationAmbient>;
  readonly environment?: ReadonlyMap<string, CapabilityResolution<unknown>>;
}

interface Application<R> {
  readonly definition: ApplicationDefinition<R>;
}

interface RunningApplication<R> {
  readonly status: Effect.Effect<ApplicationStatus>;
  readonly runtime: NexusRuntime<R | EnvironmentShape | EventBusShape>;
  readonly environment: EnvironmentShape;
}
```

The `runtime` layer may require the ambient services (`ApplicationAmbient`):
the resolved `Environment` and the application's event bus. `environment`
supplies capability resolutions already resolved; resolving them can't fail.
`RunningApplication` is frozen and exposes nothing else: its `runtime` is an
opaque handle (see [runtime.md](./runtime.md)), and its lifecycle state is
private to NEXUS.

`runtime` is a `Layer` because service composition (§6) is exactly what
`Application` hands to `Runtime` to build the service graph — `Application`
does not reimplement Effect's dependency graph, it just names the entry
point for one.

## API

```ts
namespace Application {
  function define<R>(definition: ApplicationDefinition<R>): Application<R>;
  function start<R>(app: Application<R>): Effect.Effect<RunningApplication<R>, ApplicationInitError, Scope.Scope>;
  function shutdown<R>(running: RunningApplication<R>): Effect.Effect<void>;
  function status<R>(running: RunningApplication<R>): Effect.Effect<ApplicationStatus>;
  function createState<R, A>(running: RunningApplication<R>, schema: Schema.Schema<A>, initial: A): Effect.Effect<StateHandle<A>, StateInitError>;
}
```

`start` requires a `Scope` in its context. The caller (typically a small
`main.ts`/entry point, or a test harness) owns that scope, and closing it
stops the application exactly as `shutdown` does. `Application` does not
manage process-level concerns (signal handling, `process.exit`) — that
belongs to whatever embeds NEXUS.

`createState` creates **application-owned** `State`. It lives in the
application runtime's own scope, so it ends when the application stops: its
`changes`, and every selector and stream derived from it, complete normally.
The caller supplies no `Scope`. Code reaches the returned handle by holding
it (closures, constructor arguments); nothing is registered or looked up by
name. For state a caller owns, use `State.create` in the caller's scope.

## Errors

```ts
type ApplicationInitError = { readonly _tag: "ServiceGraphFailed"; readonly cause: unknown };
```

An initialization failure is always this typed variant — never a thrown
exception or an `unknown` rejection reaching the caller. A failed `start`
returns no `RunningApplication`, and releases whatever it had built no later
than when the caller's scope closes.

`shutdown` and `status` never fail. `createState`'s only typed error is
`StateInitError`, for an invalid initial value. Using an application whose
termination has begun is misuse, and is reported as a defect, never a typed
error: `createState` is refused (it creates no `State`), and so is work run
through its `runtime` (see [runtime.md](./runtime.md)).

## Rules

- `Created → Initializing → Running → Stopping → Stopped` is the only valid
  transition path; `Initializing → Failed` is the only way to skip ahead.
  Status never moves backwards, and nothing changes it after `Stopped`.
- **A started application terminates in exactly two ways:**
  `Application.shutdown(running)`, or closing the caller's `Scope` that
  `start` ran in. Both reach the same end: status `Stopped`, every resource
  released, and every observation stream over application-owned resources
  (`State.changes` from `createState`, selectors over it, `Event.subscribe`)
  ended normally. A failed start is an initialization outcome, not a way to
  terminate.
- `shutdown` is idempotent and safe to call concurrently: the application
  terminates once, and every call returns once the status is `Stopped`.
- **New work is admitted only while `Running`.** From `Stopping` onward,
  `createState` and anything run through `running.runtime` are refused as
  defects. Effects already running when termination begins aren't
  interrupted by it.
- `start` must resolve `Environment` (§10.1) before the service graph is
  considered ready, since services may themselves depend on resolved
  capabilities.
- `Application` must never be reachable from `Command`/`Service`/`State`
  code — those only ever see `RunningApplication`'s narrower surface
  (state reads, selector reads, command invocation).

## Example

```ts
const app = Application.define({
  name: "user-admin",
  runtime: Layer.merge(UserRepositoryLive, ClockLive),
});

const program = Effect.scoped(Effect.Do.pipe(
  Effect.bind("running", () => Application.start(app)),
  Effect.bind("users", ({ running }) => Application.createState(running, UserState, initialUsers)),
  Effect.tap(({ running }) => Effect.promise(() =>
    Runtime.run(running.runtime, Command.invoke(selectUser, { userId }))
  )),
  Effect.tap(({ running }) => Application.shutdown(running))
));
```

## Testing

Covers §20 "Application": initialization, startup failure (assert a typed
`ApplicationInitError`, not a thrown exception), both termination routes,
repeated and concurrent shutdown, refusal while `Stopping`, application-owned
`State` including its races with termination, cleanup ordering, and every
lifecycle transition including the `Failed` branch.
