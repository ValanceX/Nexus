# J1: does NEXUS isolate the application boundary, or only its execution environment? (decision memo)

*2026-09-28. This memo is investigation only: `src/` is unchanged since the P1 fix (`b7f5e4d`), and nothing is released.*

**Inputs:**
- the [integration audit](./2026-09-28-valance-integration-audit.md);
- the [v0.9 outline](../superpowers/specs/2026-09-28-nexus-v0.9-outline.md) (I44–I49);
- the [v0.9 plan](../superpowers/plans/2026-09-28-nexus-v0.9-implementation.md), "As built", finding J1.

**How the experiments were run.** The probes (P1–P5, below) ran as temporary test files, which were deleted afterwards. P1–P3 used NEXUS at `b7f5e4d`. P4 and P5 used a **throwaway copy** in the session scratchpad, since discarded. The Chromium runs installed a packed build in PORT's workspace only for the run, and restored the dependency afterwards.

**Labels:** FACT / EVIDENCE, INTERPRETATION, PROPOSED CONTRACT, OPEN QUESTION.

---

## 1. What `Application.start()` returns

**FACT.** `Application.start()` **does not return a Fiber.**
- It returns `Effect<RunningApplication<R>, ApplicationInitError, Scope>` (`src/application/index.ts:82`).
- `RunningApplication<R>` is `{ status: Effect<ApplicationStatus>; runtime: NexusRuntime<R | EnvironmentShape | EventBusShape>; environment: EnvironmentShape }` (`:61-65`). The value is frozen.
- Its lifecycle is operated only through `Application.shutdown(running)` and `Application.status(running)`.
- `NexusRuntime` is an **opaque handle** with no readable member (N3, v0.3; `src/runtime/internal.ts:14`).

**FACT.** The raw Fiber comes from a different public function:
- `Runtime.runFork(handle, effect): Fiber.RuntimeFiber<A, E>` (`src/runtime/index.ts:62`), documented in `docs/primitives/runtime.md:51`.
- It returns `EffectRuntime.runFork(applicationRuntime)(effect)`: a **root fiber of the application's captured Effect runtime**, carrying the application's FiberRefs (platform Clock 42, for example).
- After termination, `runFork` returns `Effect.runFork(Effect.die(refusal))` instead.

**INTERPRETATION.** The task's framing ("`Application.start()` → Fiber") doesn't match the code. The application-level handle already exists: `RunningApplication`, with `shutdown` and `status`. What exposes an application fiber is the **execution** API, `Runtime.runFork`. Option B below is re-targeted accordingly.

## 2. Every current use

**FACT.** `RunningApplication` is used as follows:
- `running.runtime`: 58 uses in NEXUS tests, the example and PORT integration, always passed to `run`, `runFork` or `createState`;
- `running.environment`: 4 uses, all in `tests/platform.test.ts`;
- `status` and `shutdown`: through `Application.status`/`shutdown` only.

None of these exposes a fiber.

**FACT.** There are 24 call sites of `Runtime.runFork`. Classified by what the caller does with the returned fiber:

| File | Site | Operation on the fiber | What the caller uses |
|---|---|---|---|
| `tests/vertical-slice.test.ts` | 42→59, 123→138 | `Fiber.join` | the collected events (the value) |
| `tests/mesh.test.ts` | 178→183, 464→469 | `Fiber.join` | the collected events (the value) |
| `tests/mesh.test.ts` | 244→248 | `Fiber.join` | the collected renders (the value) |
| `tests/mesh.test.ts` | 360→367 | `Fiber.await` + timeout | the exit |
| `tests/mesh.test.ts` | 387→394, 400 | `Fiber.await` + timeout, then `Fiber.poll` | the exit, and completion |
| `tests/runtime.test.ts` | 43→47 | `Fiber.join` | the collected pings (the value) |
| `tests/runtime.test.ts` | 161 | `Fiber.join` | the value |
| `tests/runtime.test.ts` | 59→69, 236→244 | `Fiber.interrupt` | stop, with its finalizer |
| `tests/runtime.test.ts` | 196, 215, 233→242, 266→278 | `Fiber.await` | the exit (refusal, or completion) |
| `tests/lifecycle.test.ts` | 45→50, 55, 71→75, 243, 394, 448 | `Fiber.await` | the exit (refusal, or completion) |
| `tests/state.test.ts` | 105→109 | `Fiber.await` + timeout | the exit |
| `Port/integration/test/slice.test.ts` | 28→50 | `Fiber.join` | the collected events (the value) |
| `Port/integration/browser/slice.browser.test.ts` | 181→203 | `Fiber.join` | the collected events (the value) |

**Totals:** 9 `join`, 13 `await` (one of them followed by `poll`), 2 `interrupt`. Nothing uses `Fiber.status`, `inheritAll`, `fromFiber` or `joinAll`. There are no production callers: NEXUS has no consumer beyond its tests and PORT's private integration.

The other `Fiber.join` calls in the tests (for example `lifecycle.test.ts:164`, `runtime.test.ts:298`) are on the tests' **own** `Effect.fork` fibers. They are not application fibers, and are out of scope.

## 3. Why the callers use `join`, not `await`

**FACT.**
- Every one of the 9 `join` sites uses **only the success value**: the events, renders, pings or number collected.
- **No site reads a FiberRef afterwards.** No site relies on `join`'s FiberRef import, and none wants it.
- The only observable effect of the import is the J1 failure itself: the tracer bullet's caller reads Clock 42 after shutdown.

**INTERPRETATION.**
- `join` is used because it is Effect's conventional "wait and give me `A`, failing with `E`" operation. `Effect.fromFiber` is the same thing.
- `await` returns an `Exit`, which then needs `Effect.flatten`.
- **No current use semantically needs `join`.** All 24 sites need exactly one of three things: the completion value, the exit, or interruption.

## 4. The semantic consequence of exposing the raw application fiber

**EVIDENCE.** P1, P2 and P3 ran on NEXUS `b7f5e4d`, with a platform Clock of 42. "Caller" is the fiber holding the returned value.

| What the caller does | Caller after | Caller after shutdown |
|---|---|---|
| `runFork` → `Fiber.await` | clean | clean |
| `runFork` → `Fiber.interrupt` | clean | clean |
| `runFork` → `Fiber.poll` / `Fiber.status` | clean | clean |
| `runFork` → `Fiber.join` | **42** | **42** |
| `runFork` → `Effect.fromFiber` | **42** | **42** |
| `runFork` → `Fiber.await`, then `Fiber.inheritAll` | **42** | **42** |
| `run(Effect.forkDaemon(…))` → `Fiber.join` (no `runFork`) | **42** | **42** |
| `run(Effect.getFiberRefs)` → `Effect.setFiberRefs` (no `runFork`) | **42** | **42** |
| `run(Effect.runtime())` → run an effect on it (no `runFork`) | clean (the effect itself sees 42) | clean |
| `run(…)` returning a plain value | clean | clean |

A daemon fork is needed in the `forkDaemon` row. A plain `Effect.fork` inside `run` is interrupted when `run`'s root fiber ends, and `join` then fails before its import.

**INTERPRETATION.** There are two distinct channels.
1. **What NEXUS itself hands out: `runFork`'s fiber.**
   - The caller's ordinary result-retrieval operations (`join`, `fromFiber`) import the application's FiberRefs.
   - Everything the NEXUS docs say the fiber is for works without import: "for callers that need a `Fiber` handle back, e.g. to interrupt a long-running command" (`runtime.md:62`).
   - So the exposure grants an authority nobody documented, asked for or uses.
2. **What application code returns as a value through `run` (or `runFork`).**
   - An application effect can return a fiber, its `FiberRefs`, or its Effect `Runtime`, because `A` is unconstrained.
   - The caller can then import those FiberRefs explicitly.
   - No choice of NEXUS return type can prevent this, because it's the data the application chose to export.
   - `run(Effect.runtime())` also shows that N3's opacity is about the *handle*, not about what effects may return.

## 5. The intended authority boundary

**FACT / EVIDENCE:**
- **N3 (v0.3).** "The handle is only something to pass to `Runtime.run` and `Runtime.runFork`. No Effect `Runtime`, service `Context` or `Scope` is reachable" (`docs/releases/v0.3.md:21`). The Effect runtime was hidden deliberately, so that callers couldn't reach application internals.
- **N2 (v0.3).** An application stops only through `Application.shutdown` or closing its start scope. "Callers can't shut it down" in any other way (`runtime.md`).
- **v0.6 C15/I31 and D30.** The platform is the application's environment, acquired first and released last. The **audit's P1 and the accepted v0.9 invariants (I44–I47)** say that environment never reaches the caller.
- **`runtime.md:62`.** `runFork` exists "for callers that need a `Fiber` handle back, e.g. to interrupt a long-running command". No document mentions FiberRef propagation, in either direction, through `runFork`.
- **Usage (§2, §3).** All 24 call sites use completion, value, exit or interruption. None uses import.
- **VALANCE ownership.** The composer and PORT are the application's *callers*. The audit (§8) gives the composer the facts that NEXUS and PORT refuse to hold, not the application's environment.

**INTERPRETATION.**
- **No.** NEXUS does not intend its caller to hold a raw application fiber whose `join` imports application FiberRefs.
- The design intent, consistently from N3 to I44, is that the caller gets opaque handles and results, never the application's execution state.
- `runFork` returning the application's own root fiber predates the FiberRef question: the v0.2 API chose `Fiber.RuntimeFiber` for interruption. It is an **unexamined exposure**, not a decision.
- The honest statement today: **NEXUS has isolated the application's execution environment on the paths it controls (build, termination), but its execution API still hands the caller an Effect-level handle whose ordinary use crosses the boundary.**

**Are I44–I47 achievable under the current API?** No.
- As the current public API stands (`runFork` returning the application fiber), **I44 and I46 cannot be guaranteed for ordinary, documented use.** `runFork` + `join`, the pattern NEXUS's own tests and the tracer bullet use, puts the application's FiberRefs in the caller, and they stay after shutdown.
- **I47 fails too,** transitively: a later application started from that caller inherits them.
- **I45 is unaffected.**

## 6. Options

**EVIDENCE for Option D:**
- **P4** (a throwaway `runFork` returning a proxy fiber). All 444 tests pass unedited: the 391 existing and the 53 isolation tests. Typecheck is clean.
- **P5** (the unchanged Chromium tracer bullet, with its original `Fiber.join`, on the P4 build). 3 of 3 runs green, and the jsdom integration 15/15.
- **P3** (proxy semantics):
  - `join` returns the application's value (42), while the caller keeps its own Clock (7) and its own non-default log level (Debug);
  - `fromFiber` works, and typed failures pass through;
  - interrupting the proxy interrupts the application fiber and runs its finalizer;
  - even `inheritAll` leaves the caller unchanged;
  - refusal after shutdown still holds.

| | **A. Raw application fiber stays public** | **B. An application execution handle instead of a Fiber** | **C. Raw fiber; `join` documented as an escape hatch** | **D. `runFork` returns a proxy fiber that awaits the application fiber** (found in this investigation) |
|---|---|---|---|---|
| Semantics | as today | `runFork` returns e.g. `{ await, interrupt, poll }`, a NEXUS type; the raw fiber stays inside | as today; `await` doesn't import, and `join` does, by documentation | same type `Fiber.RuntimeFiber<A, E>`; the fiber the caller gets is a root on Effect's default runtime that awaits the application fiber and forwards interruption. `join`, `fromFiber` and `inheritAll` import nothing of the application's |
| I44/I46/I47 for what NEXUS returns | **not achievable**: ordinary `join` breaks them | achievable | **not achievable as stated**: holds only if every caller avoids `join`; the invariant becomes conditional, which is weakening | achievable (P4, P5) |
| I45 | holds | holds | holds | holds |
| Public API change | none | **breaking**: `runFork`'s exported return type changes from `Fiber.RuntimeFiber<A, E>` to a NEXUS type; `tests/exports.test.ts` (names) still passes, but all 24 call sites and `runtime.md` change | none (docs) | **none in types.** Behavior changes: the handed-out fiber's identity (`id()`) and `Fiber.status` are the proxy's, not the application fiber's; there's one extra fiber per call |
| Migration | none | 24 sites: `join` → `await` + `flatten` (9), `await` and `interrupt` renamed (15). Mechanical, since no site needs import (§3) | none | none: all 24 sites unedited |
| Consistency with the lifecycle model | inconsistent with N3's intent and I44 | consistent: a handle, as N3 made `NexusRuntime` | inconsistent: the framework boundary is bypassed by Effect's most conventional call, and composition code naturally writes `join` (every value-consuming site does) | consistent: NEXUS hands out a handle it controls, using the **same await-not-join boundary** as C29/C30 |
| Accidental violation | yes, routinely | no | yes: 9 of 9 value-consuming sites would violate it | no |

**INTERPRETATION about C.** Even though it matches Effect's semantics, C is not acceptable. A platform-isolation guarantee that holds only when callers avoid the idiomatic result-retrieval call is not a boundary. It is advice.

## 7. Can the fiber be hidden?

**INTERPRETATION** (derived from the exported types):
- **Keeping the raw fiber inside NEXUS and exposing a NEXUS type (B)** changes `runFork`'s exported return type. That is a **breaking change** to a public signature, and it is **not** a major redesign: `RunningApplication`, `Application.*` and `Runtime.run`/`make` are untouched.
- **Keeping the raw fiber inside NEXUS and exposing a proxy of the same exported type (D)** is **no public API change**: `Fiber.RuntimeFiber<A, E>` is still what's returned. It *is* a documented-behavior change for fiber identity and `status`, which no current caller uses (§2).
- Neither B nor D closes channel 2 (§4). **No NEXUS return type can**, because application effects may return any `A`, including their own fibers, `FiberRefs` or runtime.

## 8. Classification of J1

**INTERPRETATION.** J1 splits into two parts.

**J1a, the `runFork` path. Class 1: an implementation defect that can be fixed without a public API change.**
- **Why it's a defect:** the intended authority (§5) never included importing application FiberRefs, and no caller uses it (§3).
- **Why it's fixable in place:** D fixes it with the mechanism already accepted for P1 (await, never join; forward interruption). It changes no exported type, and passes every existing test unedited, plus the tracer bullet as written (P4, P5).
- It is **not** class 2, which would permit the escape: that would require weakening I44.
- It is **not** class 3: D shows that a new handle type isn't needed to establish the boundary.

**J1b, application-exported values** (`run(forkDaemon)` → `join`; `run(getFiberRefs)` → `setFiberRefs`). **Class 4: unresolved architecture, for a later milestone.**
- It needs a decision about what I44's boundary *is*, and that decision is not a matter of implementation.
- It is not caused by NEXUS's API: application code explicitly returns its own execution state, and the caller explicitly imports it.
- It is recorded, not dismissed, and I44–I47 are **not** redefined here (Task 5).

## 9. Recommended contract

**PROPOSED CONTRACT** (for decision; not implemented):
- **R1.** Everything NEXUS hands to a caller that relates to execution is a handle NEXUS controls:
  - the opaque `NexusRuntime` (N3, unchanged);
  - `run`'s `Promise`;
  - and, from v0.9, a `runFork` fiber that is **never the application's own fiber**.

  The caller may await, join, interrupt, poll and read results. **No operation on a NEXUS-returned value transfers application or platform FiberRefs into the caller.** This is I44/I46/I47 applied to `runFork`, unweakened.
- **R2.** `runFork`'s documented purpose is unchanged: interruption and completion. Documentation adds that the returned fiber is a handle for the application's execution, not that execution itself. Its `id()` and `status` describe the handle.
- **R3.** Deferred: J1b, application-authored exports of execution state (O19).

## 10. Does it belong in v0.9, and what is the public API impact?

**INTERPRETATION.**
- **J1a belongs in v0.9.** It is the same boundary as P1, it needs the same mechanism, and it has no API change. v0.9's exit criterion ("the tracer bullet green, with caller isolation") can't honestly be met without it. Releasing v0.9 with I44 claimed while `runFork` + `join` breaks it would publish a false guarantee.
- **J1b doesn't belong in v0.9.** It is O19 below.

**Exact public API impact of R1/R2 (option D):**
- Exported names, types and modules: **none**. `Runtime.runFork` stays `<R, A, E>(runtime: NexusRuntime<R>, effect: Effect<A, E, R>) => Fiber.RuntimeFiber<A, E>`.
- Behavior:
  - the returned fiber is a proxy: its `id()` and `Fiber.status` are its own;
  - `join`, `fromFiber` and `inheritAll` import no application FiberRefs;
  - results, typed failures, interruption (with finalizers) and refusal after termination are unchanged.
- A release-notes entry is needed, alongside P1's behavior change.

## 11. Next implementation step (not started)

The next step, once this memo is approved, is Plan Task A7, "J1a":
1. **Regression tests first.** Add to `tests/platform-isolation.test.ts`, as the P1 regressions were: `runFork` → `join`, `fromFiber` and `inheritAll`, each × merge/provideMerge × route. The caller must be clean after the operation, after shutdown, and in a later application. Also the value, typed failure and interruption-with-finalizer. They must fail on `b7f5e4d`.
2. **Fix** `Runtime.runFork` (`src/runtime/index.ts` only) to return a proxy that awaits the application fiber and forwards interruption. The refusal path stays as it is.
3. **Tripwire.** Returning the application fiber again must fail the new tests.
4. **Gates.** The 391 existing tests unedited; all isolation tests; the unchanged Chromium tracer bullet green against a packed candidate.
5. **Then** resume the plan's Phase 8 (documentation, including R1–R2 and O19) and Phase 9 (release).

**OPEN QUESTION O19 (J1b).**
- Should I44's boundary cover execution state that application code deliberately returns as a value? That covers a fiber it forked, its `FiberRefs`, and its Effect `Runtime`, and today it can, through `run`/`runFork`'s `A`.
- Candidates for a later milestone:
  - documenting the application's result channel as data-only by contract;
  - or accepting it as an explicit, application-authored export.
- There is no evidence yet of a real consumer doing this. Every current use returns plain data.
