# Effect.gen → Do-notation conversion + typecheck repair

## Summary

All `Effect.gen` call sites in `src/` and `examples/` are converted to the
`Effect.Do.pipe` / `bind` / `let` / `andThen` / `map` convention. The typecheck
is clean, the full suite passes at 41 tests, and the build emits correct
top-level entry points.

One correction to the brief's premise is worth recording up front: the working
tree had **66** typecheck errors, not 20, and they had **one** root cause, not
two. Details in "Root causes" below.

## Job 1 — converted call sites

| File | Site | How |
|---|---|---|
| `examples/basic-app/index.ts` | `selectUser` handler | Two sequential effects with no carried values → plain `Effect.andThen` chain. |
| `src/event/index.ts` | `EventBusLive` (`Layer.scoped`) | `andThen(PubSub.unbounded)` → `map` building the shape. Added an explicit `: EventBusShape` return annotation on the `map` so the literal is checked against the interface at the construction site. |
| `src/event/index.ts` | `subscribe` (`Stream.unwrapScoped`) | Straight pipeline: `andThen(EventBus)` → `andThen((bus) => bus.subscribe)` → `map`. No binds — each output is the next input. |
| `src/application/index.ts` | `start` | `bind`/`let` chain carrying `statusRef`, `resolutions`, `environment`, `runtime`. |
| `src/application/index.ts` | `shutdown` closure | `Effect.Do.pipe` of three `andThen`s. |
| `src/runtime/index.ts` | `make` | `bind("runtimeScope")` → `tap(addFinalizer)` → `bind("runtime")` → `map`. |

### Control flow

Two sites had real control flow rather than a straight sequence.

**`src/runtime/index.ts` — finalizer.** `Effect.addFinalizer` is a side effect
on the ambient scope, not a value producer, so it belongs in `Effect.tap`,
which threads the accumulated record through untouched. The scope is bound
first because three later steps need it.

**`src/application/index.ts` — failure branch.** `start` must record `Failed` on
the status `Ref` *before* the error escapes. Expressed as an `Effect.andThen`
over the `Exit` that returns either `Ref.set(...).pipe(Effect.andThen(Effect.fail(error)))`
or `Effect.succeed(exit.value)`. A union of two differently-typed effects is
where inference tends to give up, so the enclosing lambda carries an explicit
return annotation:

```ts
Effect.bind("runtime", ({ resolutions, statusRef }): Effect.Effect<
  Runtime.NexusRuntime<R | Capability.EnvironmentShape | EventBusShape>,
  ApplicationInitError,
  Scope.Scope
> => ...)
```

That annotation is load-bearing: without it the two branches unify to a wider
type and the `Scope.Scope` requirement is what keeps the declared signature
satisfiable. No casts were introduced.

### `bind` vs `andThen`

`Effect.bind` exists to accumulate context across steps. Where a step's output
is consumed only by the immediately following step, the value is threaded
directly with `andThen`/`map` instead, and no name enters the Do record. Every
surviving `bind`/`let` in the touched files carries a value past at least one
intervening step — audited individually.

## Job 2 — root causes of the typecheck errors

The brief described two independent root causes. There was only one; the second
was a downstream symptom of the first.

### Root cause (the only one): missing `.js` extensions on relative imports

Every test file except `tests/application.test.ts` imported local modules
without the required `/index.js` suffix. Under `moduleResolution: "NodeNext"`
this is `TS2834`:

```ts
// before
import * as State from "../src/state";
// after
import * as State from "../src/state/index.js";
```

Ten files, sixteen import specifiers.

### Why that looked like a second, inference-shaped cause

When a module specifier fails to resolve, TypeScript types the whole namespace
import as `any`. Every value drawn from it degrades, and under
`exactOptionalPropertyTypes: true` the degraded types surface far from the
import as `TS2379` and `TS7006`:

```
tests/state.test.ts(10,44): error TS2379: Argument of type 'Effect<any, unknown, unknown>'
  is not assignable to parameter of type 'Effect<any, unknown, never>' ...
tests/state.test.ts(31,37): error TS7006: Parameter 's' implicitly has an 'any' type.
```

These read exactly like `Effect.Do.pipe` chains losing inference, which is what
the brief diagnosed. They were not. Restoring the sixteen extensions took the
error count from 66 to **0** in one step, with no change to any pipe chain, no
added type parameters, and no casts. Notably `tests/selector.test.ts`,
`tests/command.test.ts`, `tests/runtime.test.ts`, `tests/capability.test.ts`,
`tests/event.test.ts` and `tests/resource.test.ts` were also failing for this
reason — including several the brief cited as clean reference files.

The errors were invisible at test time because vitest resolves extensionless
relative paths happily; only `tsc` under NodeNext rejects them.

## Also addressed

- `src/state/index.ts` — documented the `Stream.drop(ref.changes, 1)`: the drop
  exists because `SubscriptionRef.changes` replays the current value on
  subscribe, while `changes` is specified as future commits only.
- `tests/runtime.test.ts` — collapsed the multi-line `HeldShape` interface to
  the single-line style used by `ClockShape` earlier in the file, and removed
  the trailing whitespace after `let released = false;`.

## Scope note

`tests/service.test.ts` and `tests/state.test.ts` still contained raw
`Effect.gen` (the brief expected them already converted). Since the stated goal
is the convention applied consistently, their eight sites were converted too.

`tests/vertical-slice.test.ts` retains one `Effect.gen`. It is a narrative
integration test with ordered `log.push` side effects interleaved with two
conditionals; a pipe chain there would be substantially less readable, which is
the carve-out the brief allows. It is outside the `src`/`examples` grep gate.

## Verification

```
$ pnpm typecheck
$ tsc -p tsconfig.typecheck.json
(zero errors)

$ pnpm test
 ✓ tests/capability.test.ts (5 tests)
 ✓ tests/event.test.ts (3 tests)
 ✓ tests/command.test.ts (5 tests)
 ✓ tests/application.test.ts (4 tests)
 ✓ tests/runtime.test.ts (5 tests)
 ✓ tests/state.test.ts (6 tests)
 ✓ tests/vertical-slice.test.ts (2 tests)
 ✓ tests/smoke.test.ts (1 test)
 ✓ tests/resource.test.ts (3 tests)
 ✓ tests/service.test.ts (4 tests)
 ✓ tests/selector.test.ts (3 tests)

 Test Files  11 passed (11)
      Tests  41 passed (41)

$ pnpm build
$ tsc -p tsconfig.json
dist/index.js      (top level, not dist/src/)
dist/index.d.ts    (top level, not dist/src/)

$ grep -rn "Effect.gen" src examples
NONE

$ grep -rn ": any\|<any>\|as any" src tests examples
NONE

$ grep -rn 'from "\.\.\?/' tests src examples | grep -v '\.js"'
NONE
```
