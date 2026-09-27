# NEXUS application semantics audit (v0.7 → v0.8)

*Audited 2026-09-27, against `main` at `eafe012` (v0.7.0 released; `package.json` 0.7.0).*

This document is the evidence base for the v0.8 outline, [`../superpowers/specs/2026-09-27-nexus-v0.8-outline.md`](../superpowers/specs/2026-09-27-nexus-v0.8-outline.md). It records evidence. It doesn't define an API. It extends the [runtime/platform audit](./2026-09-27-runtime-platform-audit.md) (*RPA*) and the [capability model audit](./2026-09-27-capability-model-audit.md) (*CMA*). It answers one question:

> *How does an actual NEXUS application and its primitives declare the capabilities they require, at the correct semantic granularity, without coupling runtime execution to static analysis?*

Baseline: `pnpm typecheck` is clean, and `pnpm test` passes **366 tests in 26 files** (Node 22, effect 3.22). The working tree was clean. Nothing under `src/` was modified for this audit.

Read in full for this audit:
- all of `src/`: `application`, `capability`, `command`, `event` (both files), `mesh`, `resource`, `runtime` (both files), `selector`, `semantic`, `service`, `state` and the entry;
- `examples/basic-app/index.ts`;
- `tests/architecture.test.ts`, `tests/capability-model.test.ts`, `tests/exports.test.ts`, `tests/vertical-slice.test.ts`, `tests/platform/conformance.ts` and `tests/platform/reference.ts`. The lifecycle, platform, semantic and MESH test files were read for structure and pins;
- `docs/ARCHITECTURE.md` (§1–§16.1, §25, §26), `docs/ROADMAP.md` (all), `docs/FUTURE_DIRECTION.md` (§1–§6, §18, §19), `docs/semantic.md`, and every page under `docs/primitives/`;
- the v0.4 outline (§10 L1–L5), the v0.5 outline (D17, C8–C12), the v0.7 outline (all), RPA §Q, and CMA;
- MESH's and PORT's `docs/ARCHITECTURE.md`, for their capability language only.

Five claims were checked by experiment against `src/`, from a scratchpad test file outside the repository. Nothing was committed.

- **Y1. Aggregation.** Over every context of 0–3 units, with each unit's requirements in one of 9 states (unknown, or complete or partial over each subset of `{a, b}`), against all 9 profiles over `{a, b}` (**7,380 cases**), the worst per-unit classification (incompatible > opaque > supported) always equals the classification `Semantic.analyze` gives one declaration whose requirements are the **union**: the distinct ids of every unit, `complete` only if every unit's requirements are declared `complete`, otherwise `partial`. There were **0 mismatches**. Counter-check: if an undeclared unit makes the union *absent* rather than `partial`, the equivalence breaks. An undeclared unit next to a unit requiring a `notProvided` id is then *opaque* instead of *incompatible*.
- **Y2. Overlap.** A context holding an `app` declaration (`complete [A]`) next to a `users.select` declaration (`complete [B]`), against `provided: [A], notProvided: [B]`, is accepted. It gives `app` supported and `users.select` incompatible. Semantic has no containment, so it can't see that `app` was meant to include `users.select`.
- **Y3. Composition relativity.** The same `Command` value (`users.list`, calling a `UserRepository` service), started on a platform with no `acme.network`: under an `Http` implementation that `require`s `acme.network` it fails with `CapabilityUnavailableError`, and under an `InMemory` implementation it succeeds.
- **Y4. Association and dead fields.** `{ ...Command.define(…), requirements: [...] }` still type-checks as a `Command` and invokes normally. `Application.define` keeps an extra `requirements` field on `definition` when it is passed as a variable (an object literal is refused by TypeScript's excess-property check). `start` neither reads nor rejects that field: the application reaches `Running`.
- **Y5. Two lifecycle units.** A service layer that calls `Capability.require(Storage)` while it is **built** makes `start` fail, on a platform without `Storage`. A command that calls it while it **runs** leaves `start` succeeding (`Running`), and only that command fails.

The document keeps four things apart: **facts** (§A–§E, each with its evidence), **interpretations** (§F), **assumptions** (§G) and **decisions required** (§H).

---

## A. Current v0.7 boundary (facts)

| Item | v0.7 | Evidence |
|---|---|---|
| Requirement (meaning) | A declared claim that a unit can't fulfil its declared behavior unless a capability resolves `Available`. **Necessity, not use.** | v0.7 D46, C23 |
| Requirement (data) | `Semantic.Requirement { capability, provenance? }` inside `TargetRequirements { completeness, capabilities }` on one `Semantic.Declaration` | `src/semantic/index.ts` |
| Unit of a requirement | "Granularity is the producer's": per command, per service, or one declaration for the whole application | v0.7 D46; `tests/capability-model.test.ts` "granularity is the producer's" |
| Attachment | Not attached to `ApplicationDefinition` (a dead field or a gate). "Attaching facts to primitives is v0.8's question" | v0.7 D46; ROADMAP §25 L2 |
| L2 | Resolved in v0.5 by **D17**: declarations are canonical and standalone, and association is the author's concern. v0.8 reopens *the second half* ("which facts NEXUS states about its own primitives") and must revise D17 explicitly if it attaches facts | v0.5 D17; ROADMAP §25; RPA §Q |
| Identity | `Capability.id`, verbatim, nominal. No mapping and no registry | D44, D53, I34, I38 |
| Leaf | `src/semantic` imports nothing, and nothing in `src/` but the entry imports it | `tests/architecture.test.ts` (D13) |
| Gating | None. No verdict affects `start`, admission, `run` or dispatch | D10, D49, I37 |
| Pins | 11 entry namespaces; the G3 primitive runtime values; 35 `Semantic` exports and 2 runtime values; the v0.4 differential corpus compared with `toStrictEqual` (I27) | `tests/exports.test.ts`, `tests/semantic.test.ts`, `tests/semantic-compatibility.test.ts:87` |

---

## B. The application lifecycle, reconstructed (facts)

From `src/application/index.ts`, `src/runtime/index.ts` and `src/runtime/internal.ts`:

```text
Application.define({ name, runtime })          data: a name, and an opaque Layer (not built)
        │
Application.start(app, { platform? })          needs the caller's Scope
  Created → Initializing
        │ 1. the platform Layer is built         → Environment (resolutions fixed; D36)
        │ 2. the application `runtime` Layer is built, provide-merged over the platform
        │    and the event bus                    → the service graph (may consume capabilities)
        │    a failure in 1 or 2                  → Failed { ServiceGraphFailed }
        │ 3. the Environment is read from the built context
  Running
        │ admitted work: Runtime.run / Runtime.runFork (commands, forks, MESH dispatch)
        │                Application.createState (no capability involved)
        │ termination (Application.shutdown, or closing the start scope):
        │   claim → drain admitted work → Stopping → close bus → close scope
        │   (application resources, then platform) → Stopped
```

There are exactly **two places where application code executes with the `Environment` in reach**, and so can resolve a capability:

1. **The service graph build** (step 2). A `Layer` that calls `Capability.require` while building turns an `Unavailable` into `ServiceGraphFailed`: the application doesn't start (Y5).
2. **Effects admitted through `Runtime.run` / `Runtime.runFork`.** Commands are the named case (`Command.invoke`). A MESH dispatch reaches a command only through a binding, and runs the same way (`src/mesh/index.ts`, M3). A failure here fails that effect only; the application stays `Running` (Y5).

Two other places execute code, but can't resolve a capability:
- `Application.createState` executes only a `Schema` decode (`Schema.Schema<A>`, with no `R`).
- Release effects are typed `(a: A) => Effect<void>` with no `R` (`ResourceOptions.release`). They use what their unit acquired, and belong to that unit.

---

## C. Where an application exists, and as what (facts)

| Form | Exists? | As what | Evidence |
|---|---|---|---|
| **Definition / data** | Yes, partly | `Application<R> = { definition: { name, runtime } }`. `name` is data. `runtime` is an **opaque `Layer`**: a description of execution, readable only by building it | `src/application/index.ts` |
| **Runtime executable** | Yes, after `start` | `RunningApplication { status, runtime, environment }`, frozen. `runtime` is an opaque handle (N3) | same |
| **Primitive graph** | **No** | Commands, states, selectors, events and resources are plain values held by closures. `buildApp` returns them, and nothing records them. There is no registry of any primitive (ARCHITECTURE §4: "there is no command registry"; `command.md`: names unique "by convention") | `examples/basic-app/index.ts`; `src/command/index.ts` |
| **Service graph** | Only opaquely | Before start: a `Layer`, which can't be inspected without building it (RPA; v0.6 I-3). After start: a built `Context`, held in the module-private runtime record and unreachable (N3) | `src/runtime/internal.ts` |
| **Capability consumer** | Only dynamically | A capability is used when some running effect calls `resolve` or `require`. The static trace is the type `R ⊇ EnvironmentShape`, which says *some* capability may be used, never which. Types are erased (D51) | `src/capability/index.ts` |
| **Command inventory** | Only at a host | A MESH host's `commands` record lists the commands reachable from one UI. It is a runtime value the host owns, and a subset of the application | `src/mesh/index.ts` |

**Finding F1.** NEXUS has **no data representation of an application beyond its `name`**. It has no enumerable set of primitives, units or dependencies. Anything that states "the application's parts" must come from outside NEXUS's runtime values: an author, or a future producer (L5).

---

## D. Primitives and whether they can own a requirement (facts)

"Own a requirement" means that the thing, *as a NEXUS value*, is the unit whose declared behavior can't happen without a capability.

| Primitive | Identity string | Executes? | Can reach a capability? | Owns a requirement? |
|---|---|---|---|---|
| `Application` (definition) | `name` | only through `start` | through its `runtime` Layer | Its **service graph build** can (Y5). The definition value itself is data plus an opaque Layer |
| `Runtime` | none (opaque handle) | yes (an entry point) | whatever runs through it | no: it is the mechanism, not a unit |
| `Service` (a `Context.Tag`) | the tag key | no: it is a contract | no | **no**: the contract is implementation-independent (`service.md`) |
| a service **implementation** (`Service.layer`) | none of its own | at graph build | yes, at build or in its methods | yes, but it is an anonymous `Layer`, with no NEXUS identity |
| `Command` | `name` (by convention) | yes: its `handler` | yes, directly or through services | yes, **relative to the composition** it runs in (Y3) |
| `State` | none | `Schema` decode only | no (`R = never`) | no |
| `Selector` | none | a pure projection `(a: A) => B` | no typed channel | no |
| `Event` (`EventDef`) | `_tag` | no: it is data | no | no |
| `Resource` | none | inside a service or command | yes (`R`) | only as part of the unit that acquires it (ARCHITECTURE §11) |
| `Capability` | `id` | no: it is a contract | — | no: it is *what* is required, not a requirer |

**F2. Requirement-bearing behavior lives in two lifecycle positions**, and they fail differently (Y5):
- the start-time **service graph build**: failure means `ServiceGraphFailed`, and the application never runs;
- a run-time **admitted effect** (a command, a fork): failure means that effect fails, and the application keeps running.

**F3. A command's requirement is not intrinsic to the `Command` value (Y3).** When a handler reaches a capability through a service, whether it requires that capability depends on which implementation the application's `runtime` Layer composes. The same value requires `acme.network` under `Http` and nothing under `InMemory`. The only place a requirement is intrinsic is the code that calls `Capability.require` itself, and in NEXUS that is always an anonymous closure or `Layer`.

**F4. The primitives that can't execute code with an `Environment` can't require a capability.** These are `State`, `Selector`, `Event`, the `Service` contract and `Capability`. This follows from their types, with one exception: a selector projection could read a captured `RunningApplication.environment` directly. That bypasses `resolve`, and it is not a NEXUS usage pattern.

---

## E. The semantic model's reach (facts)

**F5. Semantic already represents a requirement at operation granularity, with completeness and per-occurrence provenance.** `Declaration.requirements` is exactly the v0.7 D46 fact. Absent means unknown, `complete` means exactly these, and `partial` means at least these. Duplicates keep every occurrence's span (`BuiltRequirement.provenance`). No new requirement type is needed to say "this unit can't work without X".

**F6. Semantic has no grouping or containment.** An `AnalysisContext` is a flat list of declarations. The only grouping is the context itself. A declaration named `app` is just another operation (Y2). **Inheritance can't be expressed** (a unit's requirement reaching a containing application), and neither can **overlap detection**.

**F7. The application-level classification is derivable, exactly (Y1).** For every context in the tested space, the worst per-unit classification equals the C4 classification of the union declaration. So an application-level *classification* needs no new data. The derived *verdict* is not unique, though. For a mix of `partial` and undecided, C4's step order makes the union read "operation / partial", while the units read "operation / partial" for one and "target / undecided" for another. Only the classification aggregates cleanly.

**F8. Duplicate unit identity is already a rejection.** Two declarations with the same `id` are `duplicate-identity` (C9). One context can't hold two declarations of the same unit, so merging several claims about one unit is outside Semantic.

**F9. Adding an application-level result to `AnalysisOutcome` would break a released pin.** `tests/semantic-compatibility.test.ts:87` requires `toStrictEqual` against the v0.4 reference for every v0.4-shaped context (I27). A new field on `Analyzed` breaks it. A new function breaks the 35-export and 2-runtime-value pins (`tests/semantic.test.ts`).

**F10. Data flow can't carry requirements.** C12 forbids data-flow facts from affecting verdicts. Modeling "a command uses a service implementation" as a value would need a new pass, and would reuse values for something they don't mean (I21 relates *data*).

**F11. Declaration-time provenance already exists, and is enough to locate a requirement.** A span can go on each requirement and on each declaration, and the declaration `id` says *which unit* a requirement belongs to. `Built` keeps both (I17). v0.7's O3, *capability* provenance, is a different question: which platform contribution supplied an id. Nothing in v0.8 consumes it.

**F12. There is still no consumer.** No tool, host or CLI calls `Semantic.analyze` (CMA F9 still holds). The v0.9/I1 vertical slice is the first candidate consumer (ROADMAP §10, §11).

---

## F. Interpretations

These follow from the facts above. They are not decisions.

**N1. Requirements have one natural owner: the unit of execution.** By F2–F4, a requirement is true of *code that runs*, in a *given composition*. NEXUS gives that code an identity at only two lifecycle positions: the start-time service graph, and each admitted effect (commands by name). Everything else is either incapable (F4) or anonymous (implementations, resources).

**N2. "The application" is not a requirement owner. It is the scope in which units are collected.** The application has no data form beyond `name` (F1), and Semantic has no containment (F6). So an "application requirement" is either:
- **(a)** the requirement of the *start unit*, a true application-level **necessity**: without it the application doesn't start; or
- **(b)** the **union** of its units' requirements: the capabilities that *some* unit can't work without.

These are different facts. (b) is not necessity of the whole: an application whose `export-pdf` command requires a filesystem still starts and runs everything else. **Inheriting necessity** from unit to application would be false under D46.

**N3. Requirements are composition-relative (F3).** A declaration about a command is really a claim about *that command in this application's composition*. So the natural scope of an analysis context under the platform binding is **one application composition** against **one platform statement**. This extends C22 ("one context, one binding") in the same way.

**N4. The combination algebra is already determined by C4 (F7).** Across different units it is set union, with the completeness rule of Y1. Within one unit, combining is refused (F8). No new rule is needed for ordering, duplicates or provenance: first occurrence, set semantics, and every occurrence kept are v0.4/v0.5 behavior.

**N5. Attaching requirements to primitive *values* is either dead or coupling (Y4, F3).** A field on `Command` or `ApplicationDefinition` is:
- unread by the runtime (dead, the hazard D37 removed);
- read by it (gating, I37);
- or read by the MESH adapter (a MESH capability dependency).

On `Command` it is also wrong in kind, because the value doesn't fix the composition (F3). On a `Service` tag it is wrong in kind, because the contract is implementation-independent. D17's rule, *declarations are standalone*, is what the evidence supports.

**N6. Nothing yet needs an exported application-level result.** It is derivable (F7). Exporting it breaks released pins (F9). No consumer exists (F12), and what a consumer does with it is L3.

---

## G. Assumptions

Each assumption is stated so that it can be checked, and each names what it affects.

- **G1.** The first real consumer (v0.9/I1) is a host or tool that analyzes one application composition against one platform statement before choosing to start it. *Affects:* the context scope (N3). *If wrong,* for example a per-command consumer at dispatch time, per-unit results still serve, because units stay first-class.
- **G2.** Application authors can enumerate their units: the service graph build, and the commands and long-lived forks they run. *Affects:* whether a context can cover an application. It holds for `examples/basic-app` (one layer, one command). It isn't evidenced for large applications (see O14 in the outline).
- **G3.** Declarations will be authored by hand, or by tooling outside `src/`, until capture exists (L5). *Affects:* drift (R10), and any id convention.
- **G4.** Capability ids stay nominal, and are owned by contract definers (I34, I38). *Affects:* nothing new.
- **G5.** Effect's type parameters stay erased (D51). *Affects:* the exclusion of type-derived requirements.

---

## H. Decisions required (for the outline)

1. **Ownership.** Which of these owns a requirement: application, primitive, primitive instance, operation, or layered? (§I)
2. **What "application requirement" means.** Necessity of the whole (N2a), union (N2b), or both, and which one is primary.
3. **The combination algebra**, including completeness, emptiness, duplicates, ordering, contradictions, and one unit versus many.
4. **Inheritance.** Does a unit's requirement propagate to the application, and as what?
5. **Provenance.** Is anything beyond F11 needed? Does O3 stay deferred?
6. **L2 / D17.** Does v0.8 revise D17, or close L2 with D17 confirmed?
7. **Whether any API is justified**: a field, a helper, or an aggregate export (F9, F12).
8. **Association convention.** Should a declaration's `id` follow the primitive's identity (`Command.name`)? Normative, convention, or silent?
9. **The start unit.** Does Semantic need to distinguish it (a declaration *kind*), or is it a reading?

---

## I. Candidate attachment points and requirement models

### I.1 Attachment points

| Point | Mechanism it would need | Evidence against / for | Coupling it risks |
|---|---|---|---|
| `ApplicationDefinition` field | a new field | dead or gating (Y4, D46) | start-time gating; second channel into `start` (D42) |
| `StartOptions` field | a new field | D42 forbids any field without its own decision; requirements aren't a start concern | gating; a second supply point |
| `Command` field | a new field | composition-relative (Y3); dead or read by MESH | MESH capability dependency; runtime enforcement at `invoke` |
| `Service` tag metadata | wrapping `Context.Tag` | a contract has no requirement (§D); `Service` is *exactly* a Tag | a second DI mechanism |
| a `Layer` wrapper for implementations | a NEXUS layer type | D52: no new layer type; reading it means inspecting the graph | hidden execution; platform inspection |
| Effect `R` / typed identity | type-level machinery | erased; D51 closed it | a second capability identity |
| recording `require` calls at runtime | instrumentation | runtime-derived declarations (I14, I16) | hidden execution; discovery |
| a NEXUS helper producing `Semantic.Declaration` | a NEXUS module importing `Semantic` | reverses D13 (CMA F8) | semantic imports from runtime modules |
| a registry of units keyed by name | a registry | ROADMAP §20; ARCHITECTURE §4 | registry; automatic discovery |
| decorators / annotations | a general annotation system | nothing needs one | a generic metadata system |
| **a standalone declaration per unit** (today) | none | D17; F5 | none |

### I.2 Requirement models

1. **Application-level only.** One declaration per application.
   - It exists today, and v0.7 pinned it.
   - It hides which unit needs what, gives one diagnostic, and conflates necessity (N2a) with union (N2b).
   - It can't express "the application starts, but `export-pdf` doesn't work".
2. **Primitive-level** (on `Command` or `Service` values).
   - Wrong in kind for services (§D).
   - Composition-relative for commands (Y3).
   - Adds dead fields or coupling (N5).
3. **Primitive-instance level** (per implementation, per handler closure).
   - This is where the truth is intrinsic (F3), but instances are anonymous closures and Layers.
   - Carrying data on them needs a wrapper type or a registry (§I.1).
4. **Operation level (units).** One declaration per unit of execution: the service graph build, and each admitted entry point such as a command or fork.
   - It uses the existing type (F5) and gives finer diagnostics.
   - It is composition-relative, like the fact itself.
   - The application level is derived (F7).
5. **Layered with containment** (application ⊇ services ⊇ operations, with inheritance).
   - It needs a containment relation in the IR, a new pass, and rules for complete-parent over partial-child.
   - It would make necessity inheritable, which N2 shows is false.
   - It solves an authoring-scale problem (G2) that has no evidence yet.

---

## J. Interactions

**With primitives.** Model 4 needs no primitive to change. The facts about primitives that v0.8 would state are *which roles can be units* (§D). That is documentation of meaning, not data on values. `N4` doc parity and the G3 pins are unaffected.

**With the runtime.** None, as long as no primitive value or start option carries a requirement. Y3–Y5 are observations of existing behavior, and they are the tests that pin independence. Enforcement would be a separate decision (I37).

**With Semantic.** None required. Model 4 is the released input model. An aggregate export is optional, and has costs (F9).

**With MESH.**
- The adapter imports no capability, and M1–M4 are unaffected.
- A MESH intent names `component/name`, not `Command.name`, so it reaches a unit only through the host's binding table. Relating a dispatched intent to a unit's verdict is the host's join, outside NEXUS.
- MESH owns no application capability, and nothing moves into MPRX.

**With PORT.**
- None. The contexts are platform-binding contexts (C22).
- Render-side requirements, and any implication across bindings, stay L1.
- PORT's "NEXUS → detect environment" line is still stale (RPA §L), and isn't edited from here.

---

## K. Where adding requirements could create coupling (catalogue)

| Hazard | Concrete route | How the outline must prevent it |
|---|---|---|
| **Runtime coupling** | `invoke`, `start` or `Runtime.run` reads a requirement field | no requirement field on any primitive value or start option |
| **Semantic imports** | a `Command.declare()` or `Application.requirements()` helper in `src/` | the leaf test (D13), unchanged |
| **A registry** | a table of units by name, or a list of commands on the application | no NEXUS-owned inventory; a context contains only the units its producer chose to describe |
| **Automatic discovery** | walking a `Layer`, recording `require` calls, reading `R` | declarations are authored (I14); nothing derives them |
| **Hidden execution** | building a `Layer` to learn its requirements | analysis never needs a built application (I11) |
| **Start-time gating** | comparing declarations with `RunningApplication.environment` | I37, unchanged; a characterization test for each verdict |
| **A second capability identity** | a `Requirement` holding a `Capability` value, a typed key, or a mapping | identifiers stay `Capability.id` strings (I34) |
| **Generic metadata** | a `meta` bag on primitives to "also" carry requirements | no metadata field; §I.1 |
| **MESH capability dependency** | binding tables annotated with requirements | the MESH adapter unchanged (M1–M4) |
| **A PORT dependency** | a PORT binding in the same context | C22; L1 |
| **Serialized format** | a declarations file format | none defined (O9 stays deferred) |

---

## L. Unresolved questions

- Whether an application-level result should ever be exported by `Semantic`, and in which form (F9). **Trigger:** the first consumer (L3).
- Whether the start unit needs a semantic *kind* (F2, N2a). **Trigger:** a consumer that must distinguish "won't start" from "some command won't work".
- Whether a context's **inventory** can be declared complete. Semantic can't know whether every unit of the application is present. A missing unit is invisible, not unknown. **Trigger:** a consumer that must trust an application-level *supported*.
- Whether per-entry-point declarations scale (G2), or whether shared implementations need a "uses" relation. **Trigger:** a real application at I1.
- L1, L3, L4, L5, O3, O7, O8, O9 and O10: as recorded. Nothing found here forces any of them.

## M. Contradictions discovered

1. **v0.7 D46 against ROADMAP §9's tree.** D46 lets one declaration stand for the whole application. The roadmap tree places requirements at two levels at once ("`Resource<UserRepository>` requires Network", and "Application requires Storage"). Y2 shows that the two levels, in one context, are sibling operations with no relation. So the tree can't be represented as drawn. It is representable as N2's two readings.
2. **ROADMAP §9 against F3.** The tree attaches a requirement to `Resource<UserRepository>`, a primitive. But the requirement belongs to the *implementation* composed at that position, not the `Resource` or `Service` value.
3. **The "granularity is the producer's" test (v0.7) against N2.** The test states that a whole-application declaration "gives the verdict of the union". Y1 confirms this for the *classification*. The v0.7 wording in D46 ("Application requires Network and Storage") reads as necessity. Union and necessity are different facts (N2).
4. **ARCHITECTURE §14's tree against F1.** §14 draws `Application → Runtime → Command`, and says itself that it "describes responsibility, not necessarily an implementation hierarchy". No such hierarchy exists as data. This is consistent, but it must not be read as an inventory the analysis could walk.
5. **`capability.md` against F3** (minor). "One declaration per command" is offered without noting composition relativity.

None of these is a code defect. Each is a wording or reading issue that the outline resolves.

## N. What v0.8 must not change

Everything in CMA §E and v0.7 I34–I38:
- the single supply point, and `StartOptions` exactly `{ platform? }`;
- the leaf;
- the released semantic types, codes and messages, and the v0.4 corpus (I27);
- the 11-namespace entry, the G3 pins, and the 35 and 2 pins;
- no gating;
- no registry or vocabulary;
- MESH M1–M4, and no PORT dependency.
