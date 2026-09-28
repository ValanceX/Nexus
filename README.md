# NEXUS

**Your application logic, free of any UI framework.**

NEXUS is the application core of [Valance](https://github.com/ValanceX). It holds everything your app *does*: state, commands, services, derived data, events, and access to device capabilities. It never renders a single pixel.

That separation is the point. A NEXUS application boots, runs, and shuts down cleanly with **no UI attached at all**. When you add a UI, [MESH](https://github.com/ValanceX/Mesh) describes it and [PORT](https://github.com/ValanceX/Port) draws it, and your business logic stays exactly where it was.

```text
MPRX describes intent  ──▶  NEXUS resolves behavior  ──▶  PORT realizes it
```

## Why NEXUS

- **Logic you can test without a browser.** Commands, state, and selectors are plain typed values, so you can exercise them directly in unit tests.
- **No device checks in feature code.** Haptics, camera, storage, network, and AI are typed *capabilities*. The platform the app is started on supplies them once at startup, and the app handles a missing one explicitly. No more `if (device.hasX)`, and NEXUS itself names no browser, server or device.
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
| Consume capabilities through one typed contract | Run hidden side effects inside UI bindings, or implement platforms |

NEXUS doesn't depend on the MESH compiler or language server. It sees MESH only through `@valancex/mesh-runtime`'s render trees and command intents, via the host adapter in `src/mesh` (exported as `Mesh`), never through compiler internals. The nine primitives never import the adapter.

## Getting started

Install from npm:

```console
$ pnpm add @valancex/nexus
```

To work on NEXUS itself, from a clone:

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

**v0.4: a semantic analysis foundation.** `Semantic.analyze` checks plain-data declarations of operations against an explicit target profile, without executing anything, and classifies each operation as supported, opaque or incompatible, with structured diagnostics. It is purely additive, and nothing executes differently. See [`docs/semantic.md`](./docs/semantic.md).

**v0.5: semantic IR.** `Semantic.build` turns declarations into a validated, plain-data IR with value-based data flow; `Semantic.analyze` now runs on it, with identical results. See [`docs/semantic.md`](./docs/semantic.md).

**v0.6: the runtime/platform boundary.** An application's environment is supplied only by the platform passed to `Application.start(app, { platform })`, a `Layer` providing its capabilities. The platform's resources live and die with the application: acquired first, released last. NEXUS names no execution environment, and the core's host independence is enforced at compile time. See the [release notes](./docs/releases/v0.6.md).

**v0.7: the platform capability model.** An application states what it requires as semantic declarations that name `Capability` ids. A platform states what it provides as a plain-data provision statement. `Semantic.analyze` relates the two before anything runs: supported, opaque or incompatible. It is a statement about two claims, never enforcement: `start` and capability resolution are unchanged. No API changes. See [`docs/primitives/capability.md`](./docs/primitives/capability.md) and the [release notes](./docs/releases/v0.7.md).

**v0.8: application semantics.** A requirement belongs to a *unit* of the application: the start unit (its service graph build) or an admitted unit (typically a command), each described by one standalone declaration. No primitive carries a requirement. The application's necessity is its start unit's requirement. The union over the units a context describes is its requirement set, which is not necessity. No API changes. See [`docs/semantic.md`](./docs/semantic.md), "Application contexts", and the [release notes](./docs/releases/v0.8.md).

**v0.9: caller isolation.** An application's platform and its layers can't change the code that starts, stops or observes it. FiberRefs flow into the application, never back. That covers Effect's default services (`Clock`, `Random`, `ConfigProvider`, …), log levels and any `Layer.locallyScoped`, across `start`, shutdown, `Runtime.run` and the handle `Runtime.runFork` returns, whose `Fiber.join` no longer imports the application's FiberRefs. No API changes; it is a behavioral guarantee. It was proven in a real Chromium composition of MESH, NEXUS and PORT. See the [release notes](./docs/releases/v0.9.md).

**v0.8.1:** MESH v0.6's runtime (`@valancex/mesh-runtime` `^0.6.0`), so a MESH host's render trees carry MESH v0.6's `propText`, and a release workflow as MESH's, publishing from a pushed tag. No API changes. See the [release notes](./docs/releases/v0.8.1.md).

The MESH host adapter (`Mesh`, from v0.2) renders a selector's value through `@valancex/mesh-runtime` and routes command intents to commands through explicit bindings, proven against MESH's own slice program.

Requires Node 22 or later. Published to npm as [`@valancex/nexus`](https://www.npmjs.com/package/@valancex/nexus) from v0.8.0; earlier versions were not published. See the [release notes](./docs/releases/) for what changed in each version.

## Learn more

- [**Architecture**](./docs/ARCHITECTURE.md): the design, the reasoning behind each primitive, and the rules that keep NEXUS independent
- [**Primitives reference**](./docs/primitives/README.md): detailed API docs for each building block
- [**Semantic analysis**](./docs/semantic.md): the semantic model, `Semantic.build`, the IR and `Semantic.analyze`
- [**Roadmap**](./docs/ROADMAP.md): v0.5 to v1.0; the runtime/platform boundary shipped in v0.6, the platform capability model in v0.7, application semantics in v0.8, and caller isolation, from VALANCE integration readiness, in v0.9. The cross-package evidence is in the [integration audit](./docs/architecture/2026-09-28-valance-integration-audit.md)

## Tech

TypeScript, [Effect](https://effect.website), and Effect Schema, with pnpm.

## License

MIT. See [LICENSE](./LICENSE).
