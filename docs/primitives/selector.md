# Selector

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §8. A `Selector` derives
read-only information from `State` (or other application data). Pure,
read-only, deterministic, side-effect free — every one of those four words
is a constraint on the API, not just prose (see Rules).

## Responsibility

- Answer "what does the current state mean," not "what should happen" —
  business rules that involve a decision (§8's "should this user be
  allowed to delete the account?") do not belong here; that's a `Command`
  reading `State` and applying domain logic, not a `Selector`.
- Give MESH something to bind to (`disabled={!canCheckout}`) without MESH
  ever touching `State` directly.

## Data Model

```ts
interface SelectorHandle<B> {
  readonly value: Effect.Effect<B>;
  readonly changes: Stream.Stream<B>;
}
```

Mirrors `StateHandle`'s `get`/`changes` shape deliberately (`value` instead
of `get`, since a selector is always "the current derived value," not
something you fetch with an implied side effect) — a `SelectorHandle` and a
`StateHandle` should feel interchangeable to a MESH-facing reader.

## API

```ts
namespace Selector {
  function define<A, B>(
    state: StateHandle<A>,
    project: (a: A) => B
  ): SelectorHandle<B>;

  function combine<A, B, C>(
    a: SelectorHandle<A>,
    b: SelectorHandle<B>,
    project: (a: A, b: B) => C
  ): SelectorHandle<C>;
}
```

`define` is synchronous and total — `project` is a plain `(A) => B`
function, not `(A) => Effect.Effect<B>`, which is what makes "side-effect
free" enforceable at the type level rather than just documented. `combine`
covers the common case of deriving from more than one `State`/`Selector`
without reaching for a general n-ary combinator before one is needed
(§2.1's YAGNI stance).

No `memoize`/dependency-tracking API yet — §8 is explicit that
sophisticated memoization waits for a concrete requirement. `define`'s
naive implementation (recompute `project` on every `state.changes` event,
dedupe with `Stream.changes` if `B` has an `Equal` instance) is the
starting point.

## Errors

None. A `project` function that can fail does not belong in `Selector` —
either it's actually a `Command` (has to run business logic / effects), or
the failure is impossible by construction (e.g. handled inside `project`
with a default), because "derives read-only information" excludes partial
functions by definition.

## Rules

- `project` must be pure: no `Effect`, no service calls, no I/O. This is
  why the signature is `(a: A) => B`, not `(a: A) => Effect.Effect<B>` —
  the type itself is the enforcement mechanism.
- A `SelectorHandle` must not expose a way to write back to the `State` it
  derives from.
- `Selector` never appears in `Application`'s or `Runtime`'s ownership
  diagram (§4, §14) as something separately managed — it's a read-only
  view over a `StateHandle`'s already-scoped lifetime, so it needs no
  lifecycle of its own beyond the `State` it wraps.

## Example

```ts
const canCheckout = Selector.define(
  cartState,
  (cart) => cart.items.length > 0
);

const checkoutLabel = Selector.combine(
  canCheckout,
  localeSelector,
  (can, locale) => (can ? t(locale, "checkout.enabled") : t(locale, "checkout.disabled"))
);
```

## Testing

Covers §20 "Selector": deterministic derivation (same input state always
produces the same output), reacting to dependency changes (`changes`
emits when the underlying `State` changes in a way that affects `project`'s
result), and no side effects (a `project` that attempts a service call
should not typecheck, not just "should be caught in review").
