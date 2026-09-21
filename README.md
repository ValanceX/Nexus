# NEXUS

NEXUS is the application/runtime logic layer of [VALENCE](https://github.com/valence-ui). It owns
orchestration, domain/business logic, services, use cases, commands,
selectors, state, dependency injection, effects, environment/capability
resolution, and runtime context.

**NEXUS never renders UI.** It has no knowledge of DOM, Canvas, HTML, CSS, or
any specific rendering target — that boundary belongs to
[`port`](https://github.com/valence-ui/port). UI structure and bindings are
described by [`mesh`](https://github.com/valence-ui/mesh) (the MPRX
language); NEXUS only resolves the *behavior* behind the intent MPRX
expresses.

```
       MPRX describes intent  ──▶  NEXUS resolves behavior  ──▶  PORT renders it
```

## What lives here

- **Commands** — the behavior behind intent expressed in MPRX
  (`on.select={selectUser($event)}` → a `Command.define(...)` resolved here).
- **Domain/application logic** — services, use cases, repositories, normal
  TypeScript + Effect. Not a DSL.
- **State** — application (domain) state and environment (capability) state.
  UI state is owned by the component/UI runtime, not NEXUS.
- **Selectors** — derived business state (e.g. `cart.canCheckout`).
- **Capability resolution** — hardware/environment capabilities (haptics,
  camera, network, storage, AI, screen size, input) are resolved here and
  exposed as structured services, never scattered as `if (device.hasX)`
  checks through application code.

## What does not live here

- Rendering of any kind (that's `port`).
- The MPRX language, parser, or compiler (that's `mesh`).
- Arbitrary side effects hidden inside UI bindings — MPRX expressions are
  side-effect free by design; NEXUS is where effects actually happen.

## Example

```ts
const submitOrder = Effect.fn("Order.submit")(function* (orderId) {
  const order = yield* OrderRepository.get(orderId);
  yield* OrderValidator.validate(order);
  const payment = yield* Payment.charge(order.total);
  yield* OrderRepository.markPaid(order.id, payment.id);
  return payment;
});
```

## Dependency boundary

NEXUS must **not** depend on the MESH compiler or LSP — those are
development-time tooling. NEXUS consumes MESH output only through a stable
Semantic IR / runtime adapter contract, never by importing Rust compiler
internals.

```text
              MESH Compiler
                    ↓
              MESH Semantic IR
                    ↓
              Runtime Adapter
                    ↓
NEXUS ──────────────┘
```

## Tech

TypeScript, [Effect](https://effect.website), Effect Schema. Package manager:
pnpm.

## Status

Early scaffolding. No vertical slice yet — see
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full design this
repo implements against, and [`docs/primitives/`](./docs/primitives/README.md)
for each primitive's detailed spec and API.

## License

MIT — see [LICENSE](./LICENSE).
