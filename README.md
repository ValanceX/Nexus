# NEXUS

**Your application logic, free of any UI framework.**

NEXUS is the application core of [Valance](https://github.com/ValanceX). It holds everything your app *does*: state, commands, services, derived data, events, and access to device capabilities. It never renders a single pixel.

That separation is the point. A NEXUS application boots, runs, and shuts down cleanly with **no UI attached at all**. When you add a UI, [MESH](https://github.com/ValanceX/Mesh) describes it and [PORT](https://github.com/ValanceX/Port) draws it, and your business logic stays exactly where it was.

```text
MPRX describes intent  ──▶  NEXUS resolves behavior  ──▶  PORT renders it
```

## Why NEXUS

- **Logic you can test without a browser.** Commands, state, and selectors are plain typed values, so you can exercise them directly in unit tests.
- **No device checks in feature code.** Haptics, camera, storage, network, and AI are resolved once at startup into typed *capabilities*, with explicit fallbacks when they're missing. No more `if (device.hasX)`.
- **Typed from edge to edge.** Command inputs and state are validated with Effect Schema where data enters, and events are typed by their schema. Failures are typed errors, not surprise exceptions.
- **Clean startup and shutdown.** Long-lived resources (sockets, devices, workers) are always released, even when something fails halfway. Shutdown ends every state and event stream the app owns, and nothing can stop the app behind its lifecycle's back.
- **Built on [Effect](https://effect.website).** NEXUS adds application-level concepts on top of Effect instead of reinventing dependency injection, scopes, or concurrency.

## A taste

```ts
import { Effect, Option, Schema } from "effect";
import { Command, Event, Selector, State } from "@valancex/nexus";

// `users` is a State handle, e.g. from Application.createState(running, UserState, initial)
const UserSelected = Event.define("UserSelected", Schema.Struct({ userId: UserId }));

// A command is the behavior behind MPRX intent like on.select={selectUser($event)}
const selectUser = Command.define(
  "users.select",
  Schema.Struct({ userId: UserId }),
  ({ userId }) => Effect.Do.pipe(
    Effect.andThen(State.update(users, (s) => Effect.succeed({ ...s, selectedUser: Option.some(userId) }))),
    Effect.andThen(Event.publish(UserSelected, { userId }))
  )
);

// A selector derives read-only data the UI can bind to
const selectedUser = Selector.define(users, (s) => s.selectedUser);
```

For a complete runnable version, see [`examples/basic-app`](./examples/basic-app/index.ts).

## The building blocks

NEXUS has nine primitives, each with one job:

| Primitive | In plain terms |
|---|---|
| [**Application**](./docs/primitives/application.md) | The whole app: starts it up, runs it, shuts it down |
| [**Runtime**](./docs/primitives/runtime.md) | Where effects actually run, and what cleans up after them |
| [**Service**](./docs/primitives/service.md) | A typed dependency, like a user repository or a clock |
| [**State**](./docs/primitives/state.md) | Data your app owns, changed only through explicit updates |
| [**Selector**](./docs/primitives/selector.md) | A read-only view computed from state |
| [**Command**](./docs/primitives/command.md) | Something the app should *do*, triggered by the UI or anything else |
| [**Capability**](./docs/primitives/capability.md) | Something the *device* may or may not provide |
| [**Resource**](./docs/primitives/resource.md) | Anything that must be opened and reliably closed |
| [**Event**](./docs/primitives/event.md) | A typed record that something happened |

## Where NEXUS fits

| NEXUS does | NEXUS does not |
|---|---|
| Run business rules, services, and use cases | Render anything (that's PORT) |
| Own application state and derived data | Parse or compile MPRX (that's MESH) |
| Resolve device capabilities in one place | Run hidden side effects inside UI bindings |

NEXUS doesn't depend on the MESH compiler or language server. It sees MESH only through `@valancex/mesh-runtime`'s render trees and command intents, via the host adapter in `src/mesh` (exported as `Mesh`), never through compiler internals. The nine primitives never import the adapter.

## Getting started

```console
$ pnpm install
$ pnpm test        # run the test suite
$ pnpm typecheck
$ pnpm build
```

## Status

**v0.3: a closed application lifecycle.** All nine primitives are in place, and a UI-free vertical slice runs end to end.
- **Lifecycle:** an application stops in exactly two ways, `Application.shutdown` or closing the scope it started in, and its status never moves backwards.
- **Shutdown:** it ends everything the application owns, including state created with `Application.createState` and every `Event.subscribe` stream. New work is refused once shutdown has been requested.
- **Opaque runtime:** the runtime handle exposes no Effect internals.
- **Docs match the code:** every primitive doc now matches the exported types.

**v0.4 (unreleased): a semantic analysis foundation.** `Semantic.analyze` checks plain-data declarations of operations against an explicit target profile, without executing anything, and classifies each operation as supported, opaque or incompatible, with structured diagnostics. It is purely additive, and nothing executes differently. See [`docs/semantic.md`](./docs/semantic.md).

The MESH host adapter (`Mesh`, from v0.2) renders a selector's value through `@valancex/mesh-runtime` and routes command intents to commands through explicit bindings, proven against MESH's own slice program.

Requires Node 22 or later. Not yet published to npm. See the [release notes](./docs/releases/) for what changed in each version.

## Learn more

- [**Architecture**](./docs/ARCHITECTURE.md): the design, the reasoning behind each primitive, and the rules that keep NEXUS independent
- [**Primitives reference**](./docs/primitives/README.md): detailed API docs for each building block
- [**Semantic analysis**](./docs/semantic.md): the v0.4 semantic model and `Semantic.analyze`

## Tech

TypeScript, [Effect](https://effect.website), and Effect Schema, with pnpm.

## License

MIT. See [LICENSE](./LICENSE).
