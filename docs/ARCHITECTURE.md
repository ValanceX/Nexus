# NEXUS Architecture

This is the design reference for NEXUS: what each primitive is for, how the pieces fit together, and the rules that keep NEXUS independent of any UI. It's the authoritative spec for this repo. For how NEXUS fits alongside [MESH](https://github.com/ValanceX/Mesh) and [PORT](https://github.com/ValanceX/Port), start at the [ValanceX organization page](https://github.com/ValanceX).

## Start here

**The one-sentence version:** NEXUS is everything your application *does*, meaning its state, actions, dependencies, and device access, packaged so that it runs with no UI at all.

**The nine primitives, in plain terms:**

| Primitive | Think of it as… | Section |
|---|---|---|
| Application | The whole app: start, run, stop | §4 |
| Runtime | The engine that runs effects and cleans up after them | §5 |
| Service | A typed dependency you can swap (real, fake, in-memory) | §6 |
| State | Data the app owns, changed only on purpose | §7 |
| Selector | A read-only view computed from state | §8 |
| Command | "Please do this." An action, often triggered by the UI | §9 |
| Capability | Something the device might provide (camera, haptics, AI, …) | §10 |
| Resource | Anything you open and must reliably close | §11 |
| Event | "This happened." A typed fact | §12 |

**How to read this document:**

- **Evaluating NEXUS?** Read §1–§3, skim §9 (Command) and §10 (Capability), then look at §19 (Example) and §24 (the big-picture diagram).
- **Building an app with it?** Read §4–§13 in order. Each section links to the detailed API page in [`primitives/`](./primitives/README.md).
- **Contributing to NEXUS itself?** You'll also want §15–§17 (boundaries and layout), §20–§24 (testing, scope, and definition of done), and §26 (decisions already made).

A note on tone: this spec uses **must** and **should** deliberately. *Must* is a hard rule. *Should* is a strong default you'd need a good reason to break.

---

## 1. Purpose

NEXUS is the application-semantic core of Valance.

It is responsible for:

* application lifecycle
* application state
* application commands
* typed services and dependencies
* derived state
* environment capabilities
* long-lived resources
* typed events
* effect execution
* dependency composition
* runtime and shutdown boundaries

NEXUS does **not** render UI.

NEXUS does **not** know about MPRX, MESH rendering, DOM, Canvas, native widgets, or specific hardware APIs.

The goal is to make NEXUS usable independently of MESH and PORT. NEXUS core, meaning the nine primitive modules under `src/`, has no MESH dependency. The single MESH integration boundary is the host adapter in `src/mesh/` (§15). It ships in the same package, but core never imports it, and a test enforces that.

A valid NEXUS application should be able to exist and run without any UI renderer.

---

## 2. Design Principles

### 2.1 Application semantics over framework abstractions

NEXUS should expose concepts that have meaning at the application level.

Do not create abstractions merely because they are common in frameworks.

Avoid primitives such as:

* Controller
* Repository
* Store
* Manager
* UseCase
* Facade
* Provider
* Middleware

unless a concrete NEXUS requirement later demonstrates that one is necessary.

These concepts should normally be composed from NEXUS primitives:

```text
Repository → Service
Use Case   → Command + Effect
Store      → State + Selector
Controller → Command
Adapter    → Service / Capability
```

### 2.2 Effect is the execution foundation

NEXUS is built on Effect. Do not recreate Effect primitives unnecessarily.

Use Effect for: effects, dependency injection, layers, contexts, scopes,
resource acquisition/release, typed errors, concurrency, scheduling,
cancellation, structured execution.

NEXUS adds application semantics on top of Effect.

### 2.3 Explicit boundaries

Every primitive must have a clear responsibility. A primitive should not
silently absorb responsibilities belonging to another primitive.

### 2.4 Strong typing

NEXUS should favor explicit types, Effect Schema, discriminated unions,
branded identifiers, immutable state, pure transformations, typed errors.
Do not use `any` to bypass architectural or type problems. Avoid
stringly-typed contracts when a typed representation is possible.

### 2.5 Deterministic behavior

Prefer `input → transformation → output` over hidden mutation and implicit
behavior. State transitions, selectors, command inputs, events, and
capability contracts should be observable and testable.

---

## 3. Primitive Set

```text
Application
Runtime
Service
State
Selector
Command
Capability
Resource
Event
```

Effect primitives remain the underlying implementation foundation:

```text
Effect
Schema
Context
Layer
Scope
```

```text
Effect primitives
        ↓
NEXUS application primitives
        ↓
Valance application
```

NEXUS should not duplicate Effect.

---

## 4. Application

> Full spec + API: [`primitives/application.md`](./primitives/application.md)

`Application` represents the root boundary of a NEXUS application. It is
responsible for:

* defining the application composition
* bootstrapping dependencies
* initializing application state
* resolving environment capabilities
* starting long-lived services/resources
* owning the application lifetime
* shutting the application down

`Application` is the top-level composition root. It owns exactly two direct
children — `Runtime` (execution) and `Environment` (capability resolution)
— and everything else is reached through one of those two. This is the
single ownership model for the whole spec; §14's relationship diagram is
the same tree, not an alternative to it:

```text
Application
  ├── Runtime
  │     ├── State
  │     ├── Command
  │     └── Service
  └── Environment
        └── Capability
```

`State` under `Runtime` means *application-owned* state: created with
`Application.createState`, it lives in the application runtime's own scope
and ends when the application stops. (State a caller owns, from
`State.create`, lives in the caller's scope instead.) `Command` under
`Runtime` means commands *execute* within it: commands are plain values,
run through `Runtime.run`/`Runtime.runFork`; there is no command registry.

`Resource` and `Event` are deliberately not drawn as direct children of
either box: a `Resource` is acquired *within* a `Service` implementation or
a `Command`'s effect, scoped to the `Runtime`'s application `Scope` (see
§11); an `Event` is something a `Command` or `Service` emits as it runs,
not a thing `Application` owns and manages the lifecycle of (see §12).

The application should have an explicit lifecycle:

```text
Created
  ↓
Initializing
  ↓
Running
  ↓
Stopping
  ↓
Stopped
```

Initialization failures must be represented as typed failures rather than
hidden exceptions. A failed start (`Initializing → Failed`) returns no
running application, so it is not a way of terminating one.

A started application terminates in exactly two ways: `Application.shutdown`,
or closing the caller's scope that `start` ran in. Both reach `Stopped`
once, release everything, and end every observation stream over
application-owned resources normally. Status never moves backwards, and from
`Stopping` onward new work is refused. See
[`primitives/application.md`](./primitives/application.md).

---

## 5. Runtime

> Full spec + API: [`primitives/runtime.md`](./primitives/runtime.md)

`Runtime` is the execution boundary of NEXUS. It owns:

* Effect execution
* application scope
* service dependency graph
* lifecycle
* cancellation
* resource cleanup
* fatal error handling
* application shutdown

`Runtime` does **not** own `Environment` — capability resolution is a
sibling concern handled directly under `Application` (§4, §10.1), not
something the execution boundary mediates. Keeping the two separate means
capability resolution can happen (and fail, and report typed diagnostics)
independently of whether the effect runtime has started.

```text
Runtime
  ├── Effect Runtime
  ├── Application Scope
  ├── Service Graph
  └── Lifecycle
```

The runtime should provide a controlled environment for executing commands
and other application effects. The runtime must not become a global service
locator. Application dependencies should remain explicit.

Concretely: a `NexusRuntime` is an **opaque handle**. Callers pass it to
`Runtime.run`/`Runtime.runFork`, and nothing reachable from it is the
Effect runtime, the service `Context` or the runtime's `Scope`. A runtime
terminates once, in a fixed order: the request stops admitting new work at
once, termination waits for work already admitted, begins (for an
application, entering `Stopping`), closes its event bus, then releases its
resources. An application's runtime can't be shut
down directly; a standalone runtime from `Runtime.make` ends when its
owner's scope closes. See [`primitives/runtime.md`](./primitives/runtime.md).

---

## 6. Service

> Full spec + API: [`primitives/service.md`](./primitives/service.md)

A `Service` represents a typed application dependency.

Examples: `UserRepository`, `AuthenticationService`, `ImageProcessor`,
`Clock`, `Logger`, `Persistence`, `NetworkClient`.

A service describes an interface rather than a concrete implementation:

```ts
interface UserRepository {
  readonly getUser: (
    id: UserId
  ) => Effect.Effect<User, UserNotFoundError>;
}
```

Infrastructure provides implementations:

```text
UserRepository
    │
    ├── HttpUserRepository
    ├── IndexedDbUserRepository
    └── InMemoryUserRepository
```

NEXUS should use Effect `Context` and `Layer` for service dependency
composition.

### Service rules

A service:

* must have a typed contract
* may perform effects
* may depend on other services
* may own infrastructure integration through an implementation
* must not depend on UI rendering
* should not directly inspect renderer-specific state

---

## 7. State

> Full spec + API: [`primitives/state.md`](./primitives/state.md)

`State` represents application-owned mutable state:

```text
Current immutable value
+
Controlled transitions
+
Observation
```

```ts
type UserState = {
  readonly users: ReadonlyArray<User>;
  readonly selectedUser: Option<UserId>;
  readonly loading: boolean;
};
```

State transitions should be explicit:

```text
State
  ↓
Transition
  ↓
New State
```

Prefer `(previous, action) => next` over arbitrary mutation.

State should support: initialization, reading, controlled updates,
subscriptions/observation, lifecycle, optional persistence integration.

Do not make `State` merely an Effect `Ref`, RxJS `BehaviorSubject`, or
mutable object wrapper. NEXUS `State` is an application-level semantic
abstraction.

---

## 8. Selector

> Full spec + API: [`primitives/selector.md`](./primitives/selector.md)

A `Selector` derives read-only information from state or other application
data. The canonical constructor is `Selector.define` — used consistently
everywhere in this document and in the root Valance architecture doc (there
is no separate `Selector.from`; earlier drafts used both names for the same
thing, and `Selector.define` is the one that stays):

```ts
const selectedUser = Selector.define(
  usersState,
  state =>
    state.selectedUser.pipe(
      Option.flatMap(id =>
        Array.findFirst(user => user.id === id)
      )
    )
);
```

Selectors must be pure, read-only, deterministic, side-effect free.

Selectors may eventually support memoization, dependency tracking,
incremental recomputation. Do not implement sophisticated memoization until
a concrete requirement exists.

### Important distinction

Selectors are appropriate for:

```text
"Which user is currently selected?"
"Is the dialog open?"
"How many users are visible?"
```

Selectors are not appropriate for:

```text
"Should this user be allowed to delete the account?"
```

Business rules belong in application/domain logic.

---

## 9. Command

> Full spec + API: [`primitives/command.md`](./primitives/command.md)

A `Command` represents an application action — "the application should
perform this operation." `Command` is a NEXUS primitive (§3); it is
defined and owned inside NEXUS, never outside it. The diagram below shows
where an MPRX-originated event crosses into NEXUS and is handled by a
command that lives there — it does not mean `Command` is external to NEXUS:

```text
MPRX event
    ↓
NEXUS
    └── Command
          ↓
        Application / Domain / Services
```

Examples: `selectUser`, `refreshUsers`, `createUser`, `deleteUser`,
`openSettings`, `submitForm`, `checkout`.

A command has: Identity, Input, Execution, Result, Failure.

```ts
Command<Input, Output, Error>
```

```ts
const selectUser = Command.define(
  "users.select",
  Schema.Struct({
    userId: UserId
  }),
  input =>
    Effect.gen(function* () {
      // application behavior
    })
);
```

Commands may: read state, modify state, call services, emit events, use
capabilities, acquire/use resources, fail with typed errors.

Commands must not: render UI, manipulate DOM, directly invoke hardware
APIs, contain renderer-specific behavior.

Commands are the primary application boundary for MESH. A MESH command intent reaches a Command only through an explicit binding in the MESH host adapter (§15).

---

## 10. Capability

> Full spec + API: [`primitives/capability.md`](./primitives/capability.md)

A `Capability` represents functionality provided by the runtime
environment. This is a Valance-specific concept.

Examples: AI inference, Haptics, Camera, Microphone, Sensors, GPU
acceleration, Specialized display, Biometric hardware, Storage, Network.

The important distinction:

```text
Service
    = application dependency

Capability
    = environment-dependent functionality
```

```text
Application requires:
    Haptics

Environment A:
    physical haptic device

Environment B:
    browser vibration API

Environment C:
    no haptic hardware
```

The application should not contain `if (device.hasHaptics) { ... }`.
Instead:

```text
NEXUS
  ↓
Capability resolution
  ↓
Haptics capability
  ↓
Application consumes typed capability
```

### 10.1 Capability Resolution

At application startup, `Environment` (§4) resolves available capabilities.
Today the resolutions are supplied already resolved, in the application's
definition; discovering them by inspecting the runtime is the intended
future shape, below, and isn't built yet:

```text
Environment
    ↓
Capability Discovery
    ↓
Capability Resolution
    ↓
Capability Implementation
    ↓
Application
```

Resolution strategies may include: native implementation, browser
implementation, remote implementation, fallback implementation, no-op
implementation, unavailable.

Unsupported capabilities must be explicit. Do not silently pretend a
capability exists.

### 10.2 Capability Contract

A capability should have a stable typed interface:

```ts
interface Haptics {
  readonly vibrate: (
    pattern: HapticPattern
  ) => Effect.Effect<void, HapticsError>;
}
```

The implementation may vary by environment.

---

## 11. Resource

> Full spec + API: [`primitives/resource.md`](./primitives/resource.md)

A `Resource` represents a long-lived external resource requiring
acquisition and release.

Examples: WebSocket, Database connection, Camera, Audio device, GPU
context, Worker, File handle, Native device connection.

A `Resource` is never acquired at the `Application` level directly (see
§4) — it is acquired *inside* whichever `Service` implementation or
`Command` effect needs it, and scoped to `Runtime`'s application `Scope`
(§5). This keeps resource lifetime tied to the code that actually uses the
resource, rather than to a global resource registry.

```text
Acquire
  ↓
Use
  ↓
Release
```

Resources should integrate with Effect `Scope`:

```ts
Resource.acquire({
  acquire: ...,
  release: ...
});
```

Resource cleanup must occur even when: commands fail, application shutdown
occurs, an effect is interrupted, initialization partially fails.

Do not implement custom lifecycle management where Effect `Scope` already
provides the required semantics.

---

## 12. Event

> Full spec + API: [`primitives/event.md`](./primitives/event.md)

An `Event` represents something that happened.

Command: "Please select this user." Event: "User selection changed."
Commands express intent. Events represent facts.

```ts
type UserSelected = {
  readonly _tag: "UserSelected";
  readonly userId: UserId;
};
```

Events should be typed, immutable, explicit, application/domain
meaningful. Like `Resource`, an `Event` is not an `Application`-level
managed object (§4) — it's emitted by whichever `Command` or `Service`
effect produces it.

Events may be consumed by: application logic, analytics, persistence,
synchronization, debugging, future plugin systems.

Do not create a giant global event bus as part of the first
implementation. Start with the smallest event mechanism necessary.

---

## 13. Schema

Effect Schema should be a first-class contract mechanism throughout NEXUS,
used where runtime validation and/or serialization matters.

Potential schema boundaries: Command input, Command output, State, Events,
Service contracts, Capability contracts, Configuration, Environment
descriptors, Persistence formats.

```ts
const UserId = Schema.String.pipe(
  Schema.brand("UserId")
);
```

Schemas should prevent invalid data from entering important application
boundaries. The boundary is where untrusted data *enters*: `Command.invoke`
decodes its `unknown` input, `State.set` validates what it commits. Events
are a *potential* boundary: an `EventDef`'s schema describes its payload,
and is used to validate or serialize events where they cross an untyped or
serialization boundary (persistence, synchronization), not at publication.
`Event.publish` is type-directed and doesn't decode (see
[`primitives/event.md`](./primitives/event.md)).

---

## 14. Primitive Relationships

This is the same tree introduced in §4, shown with `Selector`, `Effect`,
and `Event` filled in:

```text
                    Application
                         │
             ┌───────────┴───────────┐
             │                       │
          Runtime                Environment
             │                       │
      ┌──────┼──────┐                │
      │      │      │                ↓
    State  Command Service       Capability
      │      │      │
      ↓      ↓      ↓
  Selector Effect  Resource
               │
               ↓
             Event
```

`Selector` reads `State` but is not owned by it. `Resource` and `Event`
hang off the `Effect` that a `Command` or `Service` runs, per §11 and §12
— not off `Application` directly. This diagram describes responsibility,
not necessarily an implementation hierarchy. Avoid forcing every primitive
into one inheritance model; composition is preferred.

---

## 15. MESH Host Adapter

NEXUS *hosts* MESH, and MESH never calls NEXUS. MESH v0.5 is a pure function of (program, snapshot). Its runtime, `@valancex/mesh-runtime`, renders a program of compiled templates against a snapshot into a `Render`. The `Render`'s `tree` is a **render tree** of primitive components, final values, text, keys and handler ids. The runtime then turns an event reported on that tree into a **command intent**, `{command: {component, name}, arguments}`. The NEXUS side of that exchange is the host adapter in `src/mesh/`, exported as `Mesh`.

```text
NEXUS State ─▶ Selector ─▶ snapshot ─▶ mesh-runtime render() ─▶ Render (render tree)
                                                                   │  user event
NEXUS Command.invoke ◀─ adapter binding ◀─ command intent ◀─ dispatch(that Render, handler, payload)
```

The adapter is a thin integration boundary between NEXUS and `@valancex/mesh-runtime`. It does exactly two translations:

- **out:** a selector's value becomes a MESH snapshot, which `render()` turns into a `Render`.
- **in:** a command intent becomes `Command.invoke`, through an explicit binding.

It must not introduce another reactive state model (reactivity is `Selector.changes`), a render registry, a component lifecycle or a command runtime.

```ts
const host = Mesh.host({
  program,                                  // { root, templates, model }, templates compiled at build time
  scope: teamSnapshot,                      // a Selector already shaped to the manifest
  commands: {                               // key: "component/name"
    "user-card/selectUser": Mesh.bind(selectUser, (args) => ({ userId: /* from args[0] */ })),
    "users/refresh": Mesh.bind(refresh, () => ({})),
  },
});

host.render;                                // Effect<Render, MeshDiagnostics>: the current value
host.renders;                               // Stream<Render, MeshDiagnostics>: one per future commit
host.dispatch(render, handler, payload);    // Effect<Dispatched, MeshDiagnostics | UnmappedCommand | E, R>
```

**Invariants.** These are normative. Relaxing one takes a new decision in §26.

- **M1, render provenance.** `dispatch(render, …)` operates against exactly the `Render` the caller supplied. The adapter never resolves, substitutes or looks up a "current" or "latest" render. Handler ids are equal across renders of one program, so a substitution would silently act on newer data.
- **M2, no render retention.** The adapter keeps no render registry or cache, and no `Render` for later lookup. Keeping the render that's on screen is the caller's job.
- **M3, explicit bindings only.** A command intent reaches NEXUS behavior only through an explicit `commands` entry. Anything else fails with `UnmappedCommand`.
- **M4, runtime-only dependency.** The adapter uses `@valancex/mesh-runtime` and never depends on the MESH compiler at runtime (MESH invariant I15). Templates are compiled at build time.

**The translation boundary.** `bind(command, toInput)`'s `toInput` maps dynamically shaped intent arguments to a command's input. It is the trust boundary: TypeScript doesn't prove that the MESH argument shape matches the command's input. `Command.invoke`'s schema validation is authoritative, and a mismatch is `CommandValidationError`. A throw inside `toInput` means the binding is broken. It's a defect, never converted into a typed error.

**Errors.**

| Outcome | Channel | Meaning |
|---|---|---|
| `MeshDiagnostics` | typed | MESH rejected the render or dispatch input (snapshot, handler or payload) |
| `UnmappedCommand` | typed | no explicit binding for the intent's `{component, name}` |
| `CommandValidationError` | typed | the command rejected the translated input |
| the command's own error | typed | passes through unchanged |
| a `toInput` throw | defect | a broken binding |
| `TypeError`, `MeshVersionError`, `MeshInternalError`, or any other runtime rejection | defect | a programming, package or runtime defect |

**`renders` lifecycle.** `renders` emits one `Render` per future commit of the scope selector, in commit order. A render diagnostic is terminal: the stream fails with `MeshDiagnostics` and ends. It emits nothing for that commit, doesn't re-emit an earlier render, and ignores later commits. A caller that wants to recover subscribes again or calls `render`. This is the v0.2 NEXUS stream contract, not a MESH requirement. The adapter owns no scope. When the scope that owns the underlying `State` closes (for example on `Application.shutdown`, for state created with `Application.createState`), `changes` completes, and so does `renders`, without error.

**Packaging.** `@valancex/mesh-runtime` is a regular dependency. Splitting the adapter into an optional subpath or package is deferred until there's a demonstrated need to support NEXUS installations that don't use MESH (§26, decision 8).

The binding table is the only way MPRX reaches behavior. MPRX must not be able to: call arbitrary Effect, access arbitrary Service, instantiate Resource, perform hardware operations, mutate State directly, execute arbitrary TypeScript.

The v0.2 design, with its tests, is specified in [`superpowers/specs/2026-09-26-nexus-v0.2-mesh-adapter-design.md`](./superpowers/specs/2026-09-26-nexus-v0.2-mesh-adapter-design.md).

---

## 16. PORT Boundary

NEXUS must have no dependency on PORT, and — resolving an ambiguity in the
original draft — **PORT must have no dependency on NEXUS either.** PORT
only ever sees MESH **render trees**: primitive components, final values,
text, keys and handler ids, already resolved by the MESH runtime from a
snapshot the NEXUS adapter supplied (§15). It never imports or calls into
NEXUS directly. Whoever composes the app hands PORT render trees and routes
PORT's events back to the adapter's `dispatch`, together with the `Render`
they came from. This keeps the "a renderer
can be replaced without modifying application logic" invariant strict:
swapping PORT implementations can never mean re-wiring which NEXUS
services or state a renderer happens to reach into, because it never
reaches into any.

Valid dependency direction:

```text
Application → NEXUS
MESH adapter (src/mesh) → NEXUS core
MESH adapter (src/mesh) → @valancex/mesh-runtime
PORT → MESH render trees
NEXUS → Effect
```

Invalid dependency direction:

```text
NEXUS core → MESH adapter
NEXUS core → @valancex/mesh-runtime
NEXUS → @valancex/mesh-compiler (at runtime)
NEXUS → PORT
NEXUS → DOM
NEXUS → Canvas
NEXUS → MPRX
NEXUS → browser rendering APIs
PORT → NEXUS
```

---

## 17. Repository Structure

The `nexus` repository already exists and is scaffolded flat — a single
package at the repo root:

```text
nexus/
├── src/
│   ├── application/
│   ├── runtime/
│   ├── service/
│   ├── state/
│   ├── selector/
│   ├── command/
│   ├── capability/
│   ├── resource/
│   ├── event/
│   ├── mesh/            # the MESH host adapter (§15); core never imports it
│   └── index.ts
├── tests/
│   └── fixtures/mesh-slice/   # MESH's v0.5.0 slice, copied verbatim
├── examples/
├── .github/workflows/ci.yml
├── package.json
├── tsconfig.json
├── LICENSE
├── .gitignore
├── README.md
└── docs/
    └── ARCHITECTURE.md
```

This is the committed decision, not one of several options: **do not**
introduce a `packages/` directory or split primitives into separately
published packages (`@valancex/nexus-state`, `@valancex/nexus-command`, etc.)
for the first implementation. Add per-primitive subdirectories under
`src/` as the primitive set (§3) is implemented. Extract a primitive into
its own package only when a concrete dependency boundary — e.g. something
outside `nexus` needs `state` without `command` — actually demonstrates
the split is needed (§2.1's YAGNI stance applies here too).

`examples/basic-app/` and `tests/` may be added at the repo root as the
vertical slice (§22) takes shape; neither requires a `packages/`
directory.

---

## 18. Initial Public API

```ts
export {
  Application,
  Runtime,
  Service,
  State,
  Selector,
  Command,
  Capability,
  Resource,
  Event,
  Mesh      // the MESH host adapter (§15), not a primitive
};
```

Concrete per-primitive APIs (constructors, data model, errors, rules) are
now specified in [`primitives/`](./primitives/README.md) — this section
originally called the exact API "intentionally not fixed," which no longer
applies now that §26 item 6 has fixed it. The implementation agent should
still expect the primitives docs to shift as tests and the vertical slice
(§22) surface real requirements — divergence between the docs and `src/`
is a bug in one of the two, not a sign the docs were purely aspirational.

---

## 19. Example Application

```ts
const UserId = Schema.String.pipe(
  Schema.brand("UserId")
);

const UserState = Schema.Struct({
  users: Schema.Array(User),
  selectedUser: Schema.OptionFromNullOr(UserId)
});

const Users = State.create(UserState, {
  users: [],
  selectedUser: null
});

const UserRepository = Service.define("UserRepository");

const selectUser = Command.define(
  "users.select",
  Schema.Struct({
    userId: UserId
  }),
  ({ userId }) =>
    State.update(
      Users,
      state => ({
        ...state,
        selectedUser: Option.some(userId)
      })
    )
);

const selectedUser = Selector.define(
  Users,
  state =>
    state.selectedUser
);
```

The exact syntax is illustrative. The important architectural flow is:

```text
Command
  ↓
State / Service / Capability
  ↓
Effect
```

---

## 20. Testing Requirements

Every primitive must have isolated tests, focused on behavior and
invariants rather than implementation details.

**Application** — initialization, startup failure, shutdown, cleanup,
lifecycle transitions.

**Runtime** — effect execution, cancellation, scope lifetime, shutdown,
resource cleanup.

**Service** — typed dependency resolution, Layer composition, missing
dependency failures.

**State** — initialization, transitions, immutability, observation.

**Selector** — deterministic derivation, dependency changes, no side
effects.

**Command** — input validation, execution, typed failures, state
interaction, service interaction.

**Capability** — resolution of supplied implementations, fallback,
unavailable capability.

**Resource** — acquisition, usage, release, interruption cleanup.

**Event** — typed event definition, publication (type-directed, no runtime
validation), consumption, lifecycle (the bus closes with its owner)
behavior.

---

## 21. Explicit Non-Goals

The first NEXUS implementation must NOT attempt to build: UI rendering,
MPRX parsing, Tree-sitter integration, MESH compiler, LSP, DOM abstraction,
virtual DOM, component rendering, routing, form framework, animation
framework, CSS system, state-management compatibility layer, Redux
compatibility, Angular compatibility, React compatibility, plugin
marketplace, distributed event system, automatic hardware detection for
every platform.

These belong to later layers.

---

## 22. First Vertical Slice

Build:

```text
Application → Runtime → Service → State → Selector → Command
```

Then add:

```text
Capability
Resource
Event
```

The first working example should be a completely UI-free application:

```text
Application starts
    ↓
User service registered
    ↓
User state initialized
    ↓
Command executed
    ↓
State updated
    ↓
Selector derives new value
    ↓
Event emitted
    ↓
Application shuts down
    ↓
Resources released
```

If this works without MESH or PORT, NEXUS has established its
architectural independence.

---

## 23. Implementation Rules (for contributors and coding agents)

Before writing implementation code, inspect the repository and determine:

```text
FACTS       — what already exists?
ASSUMPTIONS — what architectural decisions are currently inferred?
UNKNOWN     — what has not been decided?
DECISIONS   — what does this specification explicitly require?
```

Do not invent architecture to fill every unknown. When an API decision is
ambiguous:

1. identify the smallest API satisfying the invariant
2. implement it
3. add tests
4. document the decision
5. avoid premature generalization

Prefer a working vertical slice over a complete theoretical framework.

---

## 24. Definition of Done

The initial NEXUS implementation is successful when:

* NEXUS can run without MESH
* NEXUS can run without PORT
* application state is typed and immutable
* selectors are pure
* commands have typed inputs and failures
* services are dependency-injected through Effect
* capabilities are environment-resolved
* resources have deterministic cleanup
* events are typed
* application lifecycle is explicit
* all important boundaries are testable
* no primitive requires renderer knowledge
* no primitive requires hardware knowledge
* no `any` is introduced to bypass typing
* the example application can boot, execute commands, observe state, emit
  events, and shut down cleanly

v0.2 (the MESH host adapter, §15) is done when a NEXUS application in Node
drives MESH v0.5 end to end: a selector's value renders through
`@valancex/mesh-runtime` into a `Render`, and a user event on that render's
tree becomes a command intent that reaches `Command.invoke` through an
explicit binding. The acceptance tests run the published runtime against
MESH's own slice, and a static test enforces the import boundary.

```text
                ┌───────────────┐
                │     MESH      │
                └───────┬───────┘
                        │
              ┌─────────┴─────────┐
   host adapter (src/mesh)      render tree
   (snapshot in, intent out)    (render-only)
                │                        │
                ↓                        ↓
┌─────────────────────────────┐   ┌───────────────┐
│            NEXUS             │   │     PORT      │
│                               │   └───────────────┘
│ Application                  │
│ Runtime                      │
│ State ─── Selector            │
│ Command ─ Service ─ Capability│
│ Resource ─ Event              │
└───────────────┬───────────────┘
                │
             Effect
                │
                ↓
       Infrastructure / OS

MESH and PORT remain replaceable.
NEXUS remains the application-semantic core.
PORT never depends on NEXUS — see §16.
```

---

## 25. Future Direction

The primitive set should be treated as a hypothesis, not an immutable
specification. Future work may introduce additional concepts only when
real application requirements demonstrate that existing primitives cannot
express them cleanly.

The architectural objective is not to maximize the number of abstractions.

> Build the smallest set of primitives capable of expressing a complete
> application while preserving strong boundaries between application
> semantics, UI representation, and rendering.

---

## 26. Resolved Decisions (audit fixes)

Changes made when this draft was reviewed and merged in as the repo's
authoritative spec, kept here as a record per §23's "document the
decision" rule:

1. **Selector naming** — standardized on `Selector.define`; the earlier
   draft's `Selector.from` (§8) is not a separate API.
2. **Ownership model** — `Application` owns exactly `Runtime` and
   `Environment`; `Runtime` owns `State`/`Command`/`Service`; `Environment`
   owns `Capability`. `Resource` and `Event` are not top-level
   `Application` children — they're scoped to whichever `Service`/
   `Command` effect creates them. §4 and §14 now describe one tree instead
   of two conflicting ones.
3. **`Environment` placement** — sibling of `Runtime` under `Application`,
   not nested inside `Runtime`. Capability resolution can proceed/fail
   independently of the effect runtime's own lifecycle.
4. **PORT/NEXUS dependency** (wording superseded by decision 7, rule kept) — PORT depends only on the MESH Semantic IR,
   never on NEXUS directly. The earlier draft's §16 allowed `PORT → NEXUS
   interfaces`; that's removed. Everything PORT needs (state, selector
   values, command bindings) must already be resolved into the IR before
   it reaches PORT.
5. **Repository layout** — committed to the flat `nexus/src/` layout that
   already exists on disk. The earlier draft's `packages/` split (either
   per-primitive or a nested `packages/nexus/`) is deferred indefinitely,
   not chosen-but-unbuilt.
6. **Per-primitive API specs** — each primitive in §3 now has a full spec
   (data model, API, errors, rules, example, testing notes) in
   [`primitives/`](./primitives/README.md), superseding §18's "intentionally
   not fixed." These are the committed starting contracts for the first
   vertical slice (§22), expected to evolve with implementation but not to
   be treated as placeholders.
7. **Semantic IR replaced by MESH v0.5 templates, render trees, `Render` and
   command intents** (v0.2). MESH has no "Semantic IR". It compiles templates
   at build time, renders a snapshot into a `Render` whose tree holds only
   primitives, and turns events into command intents. MESH doesn't call NEXUS:
   the NEXUS adapter hosts it (§15). This supersedes decision 4's wording (PORT
   sees render trees, not an IR) but keeps its rule: PORT never depends on NEXUS.
8. **MESH host adapter invariants and packaging** (v0.2). M1–M4 in §15 are
   normative. `renders` fails terminally on a render diagnostic, which is a
   NEXUS stream contract, not a MESH one. `@valancex/mesh-runtime` is a regular
   dependency, and splitting the adapter into an optional subpath or package
   is deferred until there's a demonstrated need to support NEXUS installations
   that don't use MESH. This is a v0.2 scope decision, not a final long-term
   packaging choice.
9. **Lifecycle and ownership closure, and contract reconciliation** (v0.3;
   see `superpowers/specs/2026-09-26-nexus-v0.3-outline.md`).
   - `NexusRuntime` is an opaque handle; the Effect runtime, service
     `Context` and runtime `Scope` are unreachable (N3). `Runtime.shutdown`
     is removed: an application's runtime ends only through its lifecycle, a
     standalone runtime when its owner's scope closes.
   - A started application terminates in exactly two ways, once, with
     monotonic status and an idempotent `shutdown`; new work, including
     `Application.createState`, is refused as a defect from `Stopping` on
     (N2; Q1, and Q2 = A).
   - Application-owned State comes from `Application.createState`, whose
     only typed error is `StateInitError` (D1).
   - A runtime's event bus closes before any resource is released; every
     subscription ends normally and nothing is delivered after (N1, D4).
   - `Event.publish` is type-directed, with no runtime validation;
     `EventDef.schema` describes the payload (Q3 = B).
   - `ApplicationInitError` is exactly `ServiceGraphFailed`; command names are
     unique by convention, with no registry; every primitive doc matches the
     exported types (N4).
   - This is an intentional breaking change within v0.x: `NexusRuntime.scope`,
     `NexusRuntime.runtime`, `Runtime.shutdown`, `RunningApplication.shutdown`
     and `EnvironmentResolutionFailed` are removed, with no compatibility
     wrappers.
