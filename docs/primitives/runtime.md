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
  class Refusal extends Error { readonly code: RefusalCode }
  function isRefusal(value: unknown): value is Refusal;
  type RefusalCode = "terminating" | "not-a-runtime" | "not-an-application";
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

**The `runFork` handle** (v0.9, C32). The fiber `runFork` returns is an
execution handle NEXUS controls. It is not the fiber the effect runs in: the
effect runs in the application's own fiber, with the application's FiberRefs.

The handle guarantees:
- **completion:** `Fiber.await`, `Fiber.poll` and `Fiber.status` observe the
  effect's completion;
- **results:** `Fiber.join` and `Effect.fromFiber` give the effect's own
  result, and its typed failures and defects, unchanged;
- **interruption:** `Fiber.interrupt` interrupts the effect, runs its
  finalizers, and returns once it has finished, even if it is called before
  anything has run;
- **FiberRef isolation:** `Fiber.join`, `Effect.fromFiber`, `Fiber.inheritAll`
  and any other operation on the handle import none of the application's or
  platform's FiberRefs into the caller;
- **refusal:** after termination has been requested, the handle ends as a
  defect, and the effect never runs, as before.

It doesn't guarantee, and nothing may rely on:
- that `id()` identifies the fiber the effect runs in;
- that `Fiber.status` describes that fiber's own state (it describes the
  handle's);
- that the handle is the same fiber NEXUS uses internally.

NEXUS exposes no way to reach the internal fiber.

There is no `shutdown`. A runtime ends when its owner ends it: the caller's
`Scope`, for a standalone runtime; the application's lifecycle, for an
application runtime.

**Effect's default services.** `Clock`, `Console`, `Random`,
`ConfigProvider` and `Tracer` are Effect's own default services, and NEXUS
names none of them (v0.6). A runtime inherits them from the fiber that
builds it (`start` or `make`), which keeps, for example, a caller's tracing
span. For an application, the platform is the intended place to set them,
and its `runtime` layer may override them in turn. The precedence is
Effect's layer semantics: caller, then platform, then application layer,
the later one winning. `tests/default-services.test.ts` pins that order.
The NEXUS core itself reads none of them.

**Caller isolation** (v0.9, I44–I49). The runtime is built, and its Effect
runtime captured, in a child fiber of the caller. The child inherits the
caller's FiberRefs, so the precedence above holds inside the runtime. The
runtime's scope is also closed in a child fiber, at termination. NEXUS never
joins either child.

So FiberRefs flow from the caller into the runtime, and never back. A
FiberRef set by a layer (`Layer.setClock`, `setRandom`, `setConfigProvider`,
`Layer.locallyScoped`, …), in its acquisition or its release, reaches neither
of these:
- the fiber that builds or terminates the runtime, whether it succeeds, fails
  or is interrupted;
- another runtime started later.

Code running *in* the runtime sees it. A finalizer sees what its acquisition
saw, as in Effect. The caller's own FiberRef changes are its own.

**What isolation covers, and what it doesn't.** It covers the execution
boundaries NEXUS creates and controls:
- `start` and `make`;
- termination, by either route;
- `run`'s `Promise`;
- `runFork`'s handle.

It doesn't cover values the application's own effects return. An effect
that returns a fiber it forked, its `FiberRefs` or its Effect `Runtime` hands
that state to its caller by its own choice. `A` is unconstrained, and NEXUS
doesn't inspect results. Whether that should ever be constrained is open
(v0.9 outline, O19).

**Rendering is outside this.** A MESH host's `render` and `renders`
(`Mesh.host`) are not admitted work. They run wherever their caller runs
them, typically a composer on Effect's default runtime. They are outside the
application's lifecycle and runtime. This is current behavior, and an
intentional, unresolved question (v0.9 outline, O15). It is not a
guarantee.

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

The defect is a `Runtime.Refusal`, an `Error` whose `code` is stable:
`"terminating"` (termination has been requested), `"not-a-runtime"` (a handle
NEXUS didn't make) or `"not-an-application"` (the same, for an application
handle). `Runtime.isRefusal(defect)` recognizes one, including across two
installed copies of the package. Match on `code`, never on the message. (Thrown and defect errors carry `code`; typed failures in the `E` channel carry `_tag`.) It
stays a defect and never a typed failure: using a handle after termination
began is misuse, and an `E` channel on every `run` for it would make each
caller handle what it cannot fix. A command that races a shutdown reads the
code from the `Cause` (`Cause.dieOption`) to tell this refusal from a bug. `run`'s `Promise` rejects with a
`FiberFailure`, not with the `Refusal`, so `isRefusal(rejection)` is false there;
to read the `code`, use `Fiber.await(Runtime.runFork(runtime, effect))` and
`Cause.dieOption` on the failed `Exit`.

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
  which releases every `Resource` (§11) acquired while the runtime's layers
  (including the platform) were built. A `Resource` acquired inside a
  command is released when that command's own `Scope` closes
  (`Effect.scoped`), not at termination. A termination that has
  begun always completes, even when a release fails: every waiting caller
  completes normally, and only the caller that performed the termination
  re-raises the release's original failure, as a defect.
- **Concurrent calls.** Calls to `run` and `runFork` run independently and unordered; the runtime serializes nothing. `Application.shutdown` is an Effect, asynchronous.
- **"Admitted".** In this page "admitted" means work termination waits for (NEXUS's own, such as an application-owned `State` being created). The capability model's "admitted unit" (an effect run through `Runtime.run`) is a different thing and is not waited for.
- Effects already running when termination begins are not interrupted by
  it; only new work is refused. Termination does **not wait** for them
  either: it closes the runtime's `Scope` while they run, so a `Resource`
  they use can be released under them. Work started with `runFork` that must
  finish first should be awaited (`Fiber.await`) before the runtime is
  terminated. Only work admitted by NEXUS itself, such as an
  application-owned `State` being created, is waited for.
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
