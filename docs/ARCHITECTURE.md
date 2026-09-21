# NEXUS — Architecture

This is the NEXUS-relevant excerpt of the VALENCE architecture. NEXUS is one
of three independent repos (`nexus`, `mesh`, `port`) that make up VALENCE;
see each repo's own docs for its slice, or the full design doc kept in the
[VALENCE namespace folder](https://github.com/valence-ui) for the complete
picture.

## Role

NEXUS is the application/runtime logic layer.

Primary technology: TypeScript, Effect.

Responsibilities: application orchestration, domain/business logic,
services, use cases, commands, selectors, state, dependency injection,
effects, environment/capability resolution, runtime context.

NEXUS must never render UI. NEXUS should not know about DOM, Canvas, HTML,
CSS, or a specific rendering target.

```ts
const submitOrder = Effect.fn("Order.submit")(function* (orderId) {
  const order = yield* OrderRepository.get(orderId);
  yield* OrderValidator.validate(order);
  const payment = yield* Payment.charge(order.total);
  yield* OrderRepository.markPaid(order.id, payment.id);
  return payment;
});
```

Business logic remains normal TypeScript + Effect. Do NOT invent a separate
business-logic DSL.

## Commands

MPRX (owned by `mesh`) communicates intent through controlled commands:

```xml
<user-card user={user} on.select={selectUser($event)} />
```

NEXUS resolves the command:

```ts
const selectUser = Command.define(
  "user.select",
  UserIdSchema,
  function* (userId) {
    const users = yield* Users;
    yield* users.select(userId);
  }
);
```

Commands may eventually be categorized as UI / Application / System
commands, e.g. `ui.dialog.close()`, `user.select(id)`, `order.submit(id)`,
`device.haptics.vibrate(duration)`.

> MPRX expresses intent. NEXUS owns the behavior.

## State Model

**Application State** — domain/business state (`users`, `orders`, `cart`,
`account`, `permissions`). Owned by NEXUS.

**UI State** — presentation state (`selectedTab`, `isDialogOpen`,
`expandedSections`, `searchQuery`, `focusedItem`). Owned by the
component/UI runtime, *not* NEXUS.

**Environment State** — capabilities and runtime environment exposed by
NEXUS (`screenSize`, `inputCapabilities`, `networkStatus`, `haptics`,
`camera`, `AI`, `storage`).

## Selectors / Derived State

Derived business state belongs in NEXUS:

```ts
const canCheckout = Selector.define(
  "cart.canCheckout",
  CartState,
  cart => cart.items.length > 0
);
```

Do not move domain rules into MPRX merely because they are convenient to
express there.

## Hardware Capabilities

Hardware capabilities are resolved outside application feature logic. At
startup/runtime, NEXUS performs a capability handshake:

```text
Application → NEXUS → Environment/Capability Detection → Capability Resolution → Application receives resolved capability
```

Application logic should never become a collection of
`if (device.hasHaptics) ...` checks. Capabilities are resolved through NEXUS
and exposed as structured services/context. Unsupported capabilities require
an explicit resolution strategy (fallback, no-op, alternative
implementation, feature unavailable, degraded representation) — never a
silent failure.

## Dependency Boundary

NEXUS must **not** depend on the MESH compiler or LSP. MESH tooling is
development infrastructure; NEXUS consumes only a stable Semantic IR /
runtime adapter contract.

```text
              MESH Compiler
                    ↓
              MESH Semantic IR
                    ↓
              Runtime Adapter
                    ↓
NEXUS ──────────────┘
```

## Application Architecture

A feature may eventually look like:

```text
features/
└── users/
    ├── domain/
    │   ├── user.ts
    │   └── user-service.ts
    ├── application/
    │   ├── select-user.ts
    │   └── refresh-users.ts
    └── ui/
        ├── user-list/
        │   ├── user-list.ts
        │   └── user-list.mprx
        └── user-card/
            ├── user-card.ts
            └── user-card.mprx
```

Dependency direction: `MPRX → Component Model → Application Command →
Domain/Services → Effect → Infrastructure`. UI must not reach downward
directly into infrastructure.

## Invariants relevant to NEXUS

1. NEXUS never renders UI.
2. Capabilities are resolved outside application feature logic.
3. Business rules live in NEXUS/application logic, not MPRX.
4. NEXUS must not require the MESH compiler or LSP.
5. Do not use `any` to bypass unresolved type/design problems.
6. Prefer explicit types, algebraic data structures, and immutable/pure
   transformations where practical.
