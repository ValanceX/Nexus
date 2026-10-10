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
  function refusalOf(value: unknown): Refusal | undefined;
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
application runtime. `Runtime.make(layer, { shutdown: { grace } })` says how long
termination waits for the work started with `run` and `runFork` before it
interrupts what is left (see Rules, "Settling the work").

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
`FiberFailure`, not with the `Refusal`, so `isRefusal(rejection)` is false there.
`Runtime.refusalOf(value)` finds the refusal in any of the three places it can be: the
`Refusal` itself, a `Cause` (take it from an `Exit`), or `run`'s rejection; it returns
`undefined` for a bug or for anything else.

## Rules

- `Runtime.make` must fully build the service graph (`Layer` to
  `Context`) before returning — a `NexusRuntime` is only ever "ready," it
  is never in a partially-initialized state a caller could observe.
- **Termination happens once, in this order:** the request ends admission
  at once, for `run`, `runFork` and application-owned `State` alike; wait
  for work already admitted (such as an application-owned `State` being
  created) to finish; begin (for an application, it enters `Stopping`);
  close the runtime's event bus, so no event is delivered after this point
  and every subscription ends normally, and end the streams of
  application-owned `State`; **settle the work started with `run` and
  `runFork`** (below); then close the runtime's `Scope`,
  which releases every `Resource` (§11) acquired while the runtime's layers
  (including the platform) were built. A `Resource` acquired inside a
  command is released when that command's own `Scope` closes
  (`Effect.scoped`), not at termination. A termination that has
  begun always completes, even when a release fails: every waiting caller
  completes normally, and only the caller that performed the termination
  re-raises the release's original failure, as a defect.
- **Concurrent calls.** Calls to `run` and `runFork` run independently and unordered; the runtime serializes nothing. `Application.shutdown` is an Effect, asynchronous.
- **"Admitted".** In this page "admitted" means work termination waits for (NEXUS's own, such as an application-owned `State` being created). The capability model's "admitted unit" (an effect run through `Runtime.run`) is a different thing and is not waited for.
- **Settling the work (v0.12).** The effects started with `run` and `runFork` are the runtime's work, tracked from the moment they start until they exit, however they exit. After the bus closes, termination waits up to the **grace** for them to finish on their own, then interrupts what is left and waits for each to exit, so an effect has run its own finalizers, and released what it acquired, before the runtime's resources are released. The grace is `shutdown.grace` of `Runtime.make` or `Application.start`, or the one given to a call of `Application.shutdown`; it is a `Duration`, and defaults to `0`. A grace of `0` interrupts at once, after one turn of the event loop in which a subscription that ended with the bus ends its consumer; `Duration.infinity` waits for every effect, however long it takes. New work is refused throughout. The effect asking for the termination (a command may end its own application) is neither waited for nor interrupted, and a fiber an effect forked is the effect's to end. An interrupted `run` rejects with Effect's interruption (`Cause.isInterruptedOnly` is true, `Runtime.refusalOf` finds nothing), and an interrupted `runFork` fiber exits interrupted. Work that never finishes and cannot be interrupted (an uninterruptible effect that waits forever) holds termination, as it holds any `Scope`.
- **Streams that end with the runtime.** The `changes` and `values` of application-owned `State`, and so of a `Selector` over it, end when termination winds the runtime down (after the bus closes, before the work is settled), not when the last resource is released, so a consumer started with `run` ends normally instead of being interrupted to make room for a release that waits for it. A `State` created in a scope of the caller's own ends with that scope, and a consumer of it that was started with `run` is settled like any other work.
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
