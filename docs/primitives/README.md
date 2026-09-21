# NEXUS Primitives

Detailed spec + API for each primitive in the NEXUS primitive set (see
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §3). Each doc covers:
Responsibility, Data Model, API, Errors, Rules, an Example, and what §20's
testing requirements mean concretely for that primitive.

| Primitive | Owns | Doc |
|---|---|---|
| [Application](./application.md) | Composition root: owns `Runtime` + `Environment` | lifecycle, bootstrapping, shutdown |
| [Runtime](./runtime.md) | Effect execution, service graph, scope | execution boundary |
| [Service](./service.md) | Typed application dependencies | `Context`/`Layer` conventions |
| [State](./state.md) | Application-owned mutable state | transitions, observation |
| [Selector](./selector.md) | Read-only derived state | pure projections over `State` |
| [Command](./command.md) | Application actions | the MESH → NEXUS boundary |
| [Capability](./capability.md) | Environment-resolved functionality | haptics, camera, AI, storage, ... |
| [Resource](./resource.md) | Long-lived external resources | acquire/use/release via `Scope` |
| [Event](./event.md) | Facts that happened | typed, immutable, minimal bus |

These are read together with [`../ARCHITECTURE.md`](../ARCHITECTURE.md)'s
§14 ownership diagram — this index doesn't repeat that tree, each doc just
says which node it is.

## Status

These are the committed API shapes for the first vertical slice (§22),
not the theoretical final API described more loosely in the earlier draft
(§18 originally called this "intentionally not fixed" — these docs are
what fixed it, per the decision record in §26). They should still be
expected to shift as the vertical slice is implemented and tested; treat
divergence between these docs and the actual `src/` implementation as a
bug in one or the other, not as this doc being purely aspirational.
