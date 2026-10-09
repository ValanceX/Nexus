# Application

> **In plain terms:** The whole app in one value. You describe what it's made of, then `start` it and later `shutdown` it. Startup failures come back as typed errors instead of crashes, and shutdown always cleans up.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §4 for the ownership model
this belongs to. `Application` is the composition root: it owns exactly
`Runtime` and `Environment`, nothing else directly (§4, §14).

## Responsibility

- Define the application's composition (its service graph). The
  definition carries no environment: that is the platform's (v0.6).
- Bootstrap dependencies and initialize state.
- Start `Runtime` with the environment its platform supplies at `start`.
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
}

type Platform = Layer.Layer<EnvironmentShape, unknown, never>;

interface StartOptions {
  readonly platform?: Platform;
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
the resolved `Environment` and the application's event bus.

A **platform** supplies the application's environment. It is any `Layer`
that provides the resolved `Environment` and requires nothing, passed to
`start` as `options.platform`. That is the single place an environment is
supplied: the definition carries none, so one definition can start on
different platforms. A platform's capability implementations may be
host-owned values (`Capability.EnvironmentLive(map)`: the host acquires and
releases them, and may share them) or application-scoped resources (a
scoped layer that builds the map). Application code can't tell which (see
[capability.md](./capability.md)). With no `options`, or no
`options.platform`, the environment is empty and every capability resolves
`Unavailable`, exactly as in v0.5 with no `environment`.

`StartOptions` is the shape of the application-host boundary, not a
configuration bag. It holds exactly the one justified start concern,
`platform`, and any further field needs its own architectural decision.
`RunningApplication.environment` is the environment the platform built.
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
  function start<R>(app: Application<R>, options?: StartOptions): Effect.Effect<RunningApplication<R>, ApplicationInitError, Scope.Scope>;
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
exception or an `unknown` rejection reaching the caller. A platform that
fails to build is an initialization failure too: the platform is part of the
application's service graph, and `cause` tells the two apart. A failed
`start` returns no `RunningApplication`, and has released everything it
acquired, platform included, before it fails (see Rules, the lifetime
invariant).

`status` never fails, and `shutdown` has no typed error. A resource release
that dies during termination doesn't stop it: the application still reaches
`Stopped`, and every other `shutdown` call (and closing the start scope)
completes normally. Only the call that performed the termination, the
`shutdown` or the closing of the start scope that claimed it, then re-raises
the release's original failure, as a defect. `createState`'s only typed error is
`StateInitError`, for an invalid initial value. Using an application whose
termination has begun is misuse, and is reported as a defect (a
`Runtime.Refusal` with a stable `code`), never a typed error: `createState` is refused (it creates no `State`), and so is work run
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
  terminates once, and every call returns once the status is `Stopped`,
  even when a resource release fails (see Errors).
- **New work is admitted only while `Running` and no termination has been
  requested.** From the moment either termination route starts, `createState`
  and anything run through `running.runtime` are refused as defects, even
  though the status still reads `Running` while termination waits for work
  already admitted (a `createState` in progress) to finish. Only then does it
  enter `Stopping`. So a `State` was either admitted before the request and
  exists before termination begins, ending with the application, or its
  construction is refused. Admission never waits, so an admitted effect that
  requests more work can't deadlock. Effects already running when
  termination begins aren't interrupted by it.
- `start` builds the platform before the application's `runtime` layer, so
  `Environment` is resolved before the service graph and services may
  depend on resolved capabilities.
- **The lifetime invariant (v0.6).** The platform Layer is provided to the
  application-owned runtime scope; acquisition and release of platform
  resources are therefore governed by the application's lifetime:

  ```text
  platform acquisition
          ↓
  application resource acquisition
          ↓
  application running
          ↓
  shutdown (Application.shutdown, or closing the start scope)
          ↓
  application resource release
          ↓
  platform resource release
  ```

  If the platform fails to acquire, what it acquired is released and the
  `runtime` layer is never built. If the `runtime` layer fails after the
  platform acquired, application resources are released, then platform
  resources, before `start` fails. If a release fails during shutdown, the
  platform is still released last and the status still reaches `Stopped`.
  A failed start leaves nothing acquired and returns no handle.
- **Effect's default services** (`Clock`, `Console`, `Random`,
  `ConfigProvider`, `Tracer`) are Effect's, not NEXUS's: NEXUS names none of
  them. A platform is the intended place to set them, with Effect's own
  layers (`Layer.setClock`, …). Precedence is Effect's: the fiber that calls
  `start`, then the platform, then the `runtime` layer, the later one
  winning (see [runtime.md](./runtime.md)).
- **Caller isolation** (v0.9, I44–I47). FiberRefs flow from the caller into
  the application, never back. The platform's and the `runtime` layer's
  FiberRef settings apply only inside the application. This covers default
  services, log levels, and any `Layer.locallyScoped`.

  The caller never observes them across a boundary NEXUS creates:
  - `start`, including a failed or interrupted start;
  - `Application.shutdown`, or closing the start scope;
  - `Runtime.run`;
  - the handle `Runtime.runFork` returns.

  The caller doesn't observe them before, during or after the run, and no
  later application does either. See [runtime.md](./runtime.md) for what this
  does and doesn't cover.
- `Application` must never be reachable from `Command`/`Service`/`State`
  code — those only ever see `RunningApplication`'s narrower surface
  (state reads, selector reads, command invocation).

## Example

```ts
const app = Application.define({
  name: "user-admin",
  runtime: UserRepositoryLive,
});

// The host chooses the platform; the definition doesn't.
const platform = Capability.EnvironmentLive(new Map([
  [Haptics.id, { _tag: "Available", implementation: deviceHaptics }],
]));

const program = Effect.scoped(Effect.Do.pipe(
  Effect.bind("running", () => Application.start(app, { platform })),
  Effect.bind("users", ({ running }) => Application.createState(running, UserState, initialUsers)),
  Effect.tap(({ running }) => Effect.promise(() =>
    Runtime.run(running.runtime, Command.invoke(selectUser, { userId }))
  )),
  Effect.tap(({ running }) => Application.shutdown(running))
));
```

## Application semantics (v0.8)

An application states what it requires through standalone semantic
declarations, one per **unit** (see [`semantic.md`](../semantic.md),
"Application contexts"). The definition carries none: `ApplicationDefinition`
is exactly `{ name, runtime }`, and `start` reads no requirement.

- **The start unit** is the service graph build: the `runtime` layer that
  `start` builds after the platform. What it can't be built without is the
  application's **necessity**: without it, `start` fails with
  `ServiceGraphFailed`.
- **Admitted units** are effects run through `running.runtime`, typically
  commands. A command's requirement is that command's alone. It never makes
  the application fail to start.
- An analysis verdict changes nothing here. `start`, admission and capability
  resolution behave exactly as without analysis.

## Testing

Covers §20 "Application": initialization, startup failure (assert a typed
`ApplicationInitError`, not a thrown exception), both termination routes,
repeated and concurrent shutdown, refusal while `Stopping`, application-owned
`State` including its races with termination, cleanup ordering, and every
lifecycle transition including the `Failed` branch. `tests/platform.test.ts`
covers the platform: the supply point, the lifetime invariant on both routes
and every failure path, isolation between starts, and the reference test
platform. `tests/default-services.test.ts` pins default-service precedence.
