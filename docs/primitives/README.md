# NEXUS Primitives

NEXUS is built from nine small primitives. Each page below explains one of them: what it's for, what it looks like in code, how it fails, and the rules it follows.

New here? Read **State → Selector → Command** first. Those three are what most application code touches. The [Architecture doc](../ARCHITECTURE.md) (§3) explains how they all fit together.

| Primitive | In plain terms | Owns |
|---|---|---|
| [Application](./application.md) | The whole app: start, run, stop | The composition root: `Runtime` + `Environment` |
| [Runtime](./runtime.md) | Runs effects and cleans up after them | Effect execution, service graph, scope |
| [Service](./service.md) | A typed, swappable dependency | `Context`/`Layer` conventions |
| [State](./state.md) | Data the app owns, changed only on purpose | Transitions, observation |
| [Selector](./selector.md) | A read-only view computed from state | Pure projections over `State` |
| [Command](./command.md) | "Please do this." | What MESH command intents reach, through adapter bindings |
| [Capability](./capability.md) | Something the device may or may not provide | Haptics, camera, AI, storage, … |
| [Resource](./resource.md) | Anything you open and must reliably close | Acquire/use/release via `Scope` |
| [Event](./event.md) | "This happened." | Typed, immutable facts on a minimal bus |

Every page follows the same layout: **Responsibility**, **Data Model**, **API**, **Errors**, **Rules**, **Example**, and **Testing** (what §20's testing requirements mean for that primitive). For how the primitives own one another, see the §14 diagram in the Architecture doc. This index doesn't repeat it.

## Status

These are the committed API shapes for the first vertical slice (§22), and they're implemented in `src/`. v0.2 connects them to MESH through the host adapter in `src/mesh/` (ARCHITECTURE §15), which is not a primitive. If these docs and `src/` ever disagree, treat it as a bug in one or the other, not as the docs being aspirational.
