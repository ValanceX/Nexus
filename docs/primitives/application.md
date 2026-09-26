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
produces a `RunningApplication<R>`, which is the only thing you can invoke
commands against or read state from.

```ts
interface ApplicationDefinition<R> {
  readonly name: string;
  readonly runtime: Layer.Layer<R, unknown, never>;
  readonly environment?: EnvironmentDefinition;
}

interface Application<R> {
  readonly definition: ApplicationDefinition<R>;
}

interface RunningApplication<R> {
  readonly status: Effect.Effect<ApplicationStatus>;
  readonly runtime: NexusRuntime<R>;
  readonly environment: ResolvedEnvironment;
}
```

`runtime` is a `Layer` because service composition (§6) is exactly what
`Application` hands to `Runtime` to build the service graph — `Application`
does not reimplement Effect's dependency graph, it just names the entry
point for one.

## API

```ts
namespace Application {
  function define<R>(definition: ApplicationDefinition<R>): Application<R>;
  function start<R>(app: Application<R>): Effect.Effect<RunningApplication<R>, ApplicationInitError, Scope.Scope>;
  function shutdown(running: RunningApplication<unknown>): Effect.Effect<void>;
  function status(running: RunningApplication<unknown>): Effect.Effect<ApplicationStatus>;
}
```

`start` requires a `Scope` in its context — the caller (typically a small
`main.ts`/entry point, or a test harness) owns that scope and closing it is
what drives `shutdown`'s resource cleanup. `Application` does not manage
process-level concerns (signal handling, `process.exit`) — that belongs to
whatever embeds NEXUS.

## Errors

```ts
type ApplicationInitError =
  | { readonly _tag: "EnvironmentResolutionFailed"; readonly cause: unknown }
  | { readonly _tag: "ServiceGraphFailed"; readonly cause: unknown };
```

Initialization failures are always one of these two typed variants — never
a thrown exception or an `unknown` rejection reaching the caller.

## Rules

- `Created → Initializing → Running → Stopping → Stopped` is the only valid
  transition path; `Initializing → Failed` is the only way to skip ahead.
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

const program = Effect.gen(function* () {
  const running = yield* Application.start(app);
  yield* Runtime.run(running.runtime, selectUser({ userId }));
  yield* Application.shutdown(running);
});
```

## Testing

Covers §20 "Application": initialization, startup failure (assert a typed
`ApplicationInitError`, not a thrown exception), shutdown, cleanup ordering,
and every lifecycle transition including the `Failed` branch.
