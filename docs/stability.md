# API stability

What each public surface of NEXUS promises. The tiers have one meaning each. (MESH publishes the same page for its surfaces; the tier names are shared across the ValanceX packages.)

| Tier | Meaning |
|---|---|
| **Stable** | In a released version. NEXUS is 0.x, so a minor version may change it, but only with the change listed in that version's release notes under "API compatibility" or "behavior", never silently. Error `code`s and `_tag`s never change meaning and are never reused. |
| **Unreleased** | On the development branch and not in any release. Complete and tested, but it may change before one. |
| **Provisional** | Named so in the documentation. Its shape is not final, even after a release. |
| **Internal** | Not a contract. Exists because something else needs it; may change in any release without notice. |

## By surface

| Surface | Tier |
|---|---|
| `Application`, `Runtime` (`make`, `run`, `runFork`), `Service`, `State`, `Selector`, `Command`, `Capability`, `Resource`, `Event` (`define`, `publish`, `subscribe`) | Stable |
| `Runtime.Refusal`, `Runtime.isRefusal`, the type `Runtime.RefusalCode`, and the refusal `code`s | Unreleased |
| `Mesh` (the MESH host adapter, with its optional peer `@valancex/mesh-runtime`) | Stable |
| `Semantic` (`build`, `analyze` and its types) | Provisional |
| `Event.EventBusShape`, `Event.EventBusLive` | Internal: plumbing. A layer may name the bus as a requirement (`Layer.Layer<R, E, EventBusShape>`), and that use is supported, but the shape itself may change in any release |
| Anything under `dist/` that the package's `exports` doesn't list | Internal |

An error's stable identity is its `code` when it is thrown or dies (`Runtime.Refusal`), and its `_tag` when it is a typed failure in the `E` channel.
