# NEXUS runtime / platform audit (v0.5 → v0.6)

*Audited 2026-09-27, against `main` at `b6f43f8` (tag `v0.5.0` at `7c26786`, plus the revised `docs/ROADMAP.md`).*

This document is the source of truth for where NEXUS stands against the revised roadmap ([`../ROADMAP.md`](../ROADMAP.md)) and for what v0.6 must decide before it changes anything. It records evidence. It doesn't define an API.

Baseline at audit time: `pnpm typecheck` is clean, `pnpm test` passes 287 tests in 20 files, and `pnpm build` succeeds (Node 22.22, pnpm 10.33, effect 3.22.2, `@valancex/mesh-runtime` 0.5.0). The working tree was clean.

Everything cited was read in full: all of `src/`, every test file's structure, `package.json`, the tsconfigs, the vitest config, CI, the example, every document under `docs/`, the README, and the parts of the MESH and PORT repositories that NEXUS depends on or makes claims about.

Three claims were checked by experiment, not just by reading. The experiments were run outside the repository and nothing was committed:
- **E1.** `src/` typechecks with `types: []` (no Node or DOM type definitions). A probe file using `process` and `setTimeout` is **accepted** by the repository's own `tsconfig.json` and **rejected** under `types: []`.
- **E2.** `Clock.currentTimeMillis` run through `Runtime.run` on an application's runtime returns a caller-supplied clock when the caller wraps `Application.start` in `Effect.withClock`. It also returns an application-supplied clock when the application's `runtime` layer is `Layer.setClock(...)`. Otherwise it returns the host's wall clock.
- **E3.** The installed `@valancex/mesh-runtime` 0.5.0 loads its WebAssembly engine by itself only under Node (`dist/engine.js`: `isNode()` → `node:fs/promises`). Elsewhere it throws unless the host has called its `init(url)` first.

---

## A. Executive conclusion

**The current NEXUS architecture is partially aligned with the revised roadmap.**

- **Aligned.** The executable core (the nine primitives in `src/`) uses no host API. There is no `process`, timer, `Date`, `fetch`, filesystem, DOM or `node:` import in `src/` (grep, and E1). All time, scheduling and concurrency go through Effect. The semantic layer is a strict leaf with no dependency on the runtime, MESH, PORT or any platform. The MESH adapter keeps M1–M4. Nothing depends on PORT.
- **Partially aligned.** There is no designated place where an execution environment is supplied (E2). Effect's default services come from whichever fiber starts the application, or from the application's own layer, and neither route is a contract. Platform independence in `src/` holds by convention only (E1). Nothing in the build or tests would stop a Node or DOM global from entering the core. The package metadata and CI treat Node as the only host.
- **Divergent.** In the **capability model**, the application author supplies the environment. Platform provision is written into the application's definition (`ApplicationDefinition.environment`), and a public NEXUS type names execution environments (`CapabilitySource = "native" | "browser" | "remote" | "fallback"`). The documents also still plan for NEXUS to *discover* the environment (ARCHITECTURE §10.1), and for PORT to own physical platform mechanisms (FUTURE_DIRECTION §9, §15, §17, I8). The revised roadmap assigns both to platforms.

The divergence is concentrated in one primitive (`Capability`), one field (`ApplicationDefinition.environment`) and several future-direction statements. It is not spread through the runtime. v0.6 can therefore extract a boundary instead of redesigning the runtime.

---

## B. Current architecture map (as built in v0.5.0)

```text
                        host program (today: Node only: tests, example, CI)
                                        │  calls Application.start in *its* fiber
                                        │  (its Clock/Random/Console/Tracer/Scheduler
                                        │   flow into the NEXUS runtime implicitly: E2)
                                        ▼
┌──────────────────────────────── @valancex/nexus ────────────────────────────────┐
│                                                                                  │
│  Application ── define({ name, runtime: Layer, environment?: Map<id, Resolution>})│
│     │                    ▲ app author supplies BOTH behavior and environment     │
│     ├── Environment  ◀── Capability.EnvironmentLive(map) = Layer.succeed(...)    │
│     │     └── Capability { id, tag (unused) } → CapabilityResolution             │
│     │                         source: "native" | "browser" | "remote" | "fallback"│
│     └── Runtime (opaque handle; WeakMap registry; admission + ordered termination)│
│           ├── Effect Runtime (captured from the caller's fiber + built Context)  │
│           ├── Scope (closes after the event bus)                                 │
│           ├── Service graph (Layer.buildWithScope)                               │
│           ├── Event bus (PubSub; closes first)                                   │
│           └── State (SubscriptionRef + Schema) ── Selector ── Command (Schema)   │
│                 Resource = Effect.acquireRelease                                  │
│                                                                                  │
│  Semantic (leaf, no imports, plain data): declarations + TargetProfile           │
│           → build → Built IR → compatibility → supported / opaque / incompatible  │
│                                                                                  │
│  Mesh adapter (src/mesh) ── @valancex/mesh-runtime (WASM; Node autoload / init)  │
└──────────────────────────────────────────────────────────────────────────────────┘
                     │ Effect (effect ^3.10; default services read host globals)
                     ▼
                JS host (Node 22+; the only host that has been exercised)

PORT: not referenced (its packages are empty scaffolds: `export {}`).
Platform packages: none exist.
Tooling: none (pnpm scripts, vitest, tsc).
```

---

## C. Desired architecture map (from the roadmap)

```text
Effect                                   (compositional/runtime mechanism)
  ↓
NEXUS runtime + application semantics    (lifecycle, state, selectors, commands,
  ↓                                       resources, events, semantic facts)
platform contracts                       (NEXUS-named capability contracts,
  ↓                                       expressed as Effect services/Context)
platform implementations                 (Effect Layers supplied by a platform)
```

```text
NEXUS application  →  MESH (template/render semantics)  →  PORT (target lowering)  →  target
```

```text
Tooling (build, dev server, HMR/SSR orchestration, CLI)
  ↓ composes, never owns semantics
NEXUS + MESH + PORT + platform
```

---

## D. Runtime ownership table

| Component | Current owner | Intended owner | Status | Evidence |
|---|---|---|---|---|
| Application lifecycle (status, two termination routes, monotonic, idempotent shutdown) | NEXUS | NEXUS | aligned | `src/application/index.ts:60-111`; `tests/lifecycle.test.ts` |
| Admission and ordered termination (claim → drain → `Stopping` → bus → scope → `Stopped`) | NEXUS, built on Scope/Deferred | NEXUS | aligned | `src/runtime/internal.ts:102-166` |
| Opaque runtime handle and module-level registries | NEXUS | NEXUS | partial: assumes one module instance per realm (see E-7) | `src/runtime/internal.ts:50`, `src/application/index.ts:56` |
| Service graph construction | Effect (`Layer.buildWithScope`) | Effect | aligned | `src/runtime/index.ts:32-35` |
| Effect default services (Clock, Random, Console, Tracer, Scheduler) | implicit: the starting fiber, or the application's own layer (E2) | Effect infrastructure, **supplied by the platform/host at a designated seam** | partial | `src/runtime/index.ts:34` (`Effect.runtime()` captures caller FiberRefs); E2 |
| `Runtime.run` → `Promise`; `Runtime.runFork` → `Fiber` | NEXUS | NEXUS (host bridge; no host API) | aligned | `src/runtime/index.ts:52-62`; `runtime.md` explains why |
| State | NEXUS (SubscriptionRef + Schema) | NEXUS | aligned | `src/state/index.ts` |
| Selector | NEXUS | NEXUS | aligned | `src/selector/index.ts` |
| Command | NEXUS | NEXUS | aligned | `src/command/index.ts` |
| Event bus | NEXUS (PubSub) | NEXUS | partial: `EventBusShape` is public and exposes `Queue.Dequeue`/`Scope` mechanics and an internal `Envelope` type | `src/event/index.ts:19-22` |
| Resource | Effect (`acquireRelease`) under a NEXUS name | NEXUS naming over Effect | aligned for v0.6 (application resource *semantics* are v0.8) | `src/resource/index.ts` |
| Service | Effect (`Context.Tag`) under a NEXUS name | same | aligned (deliberate, ARCHITECTURE §6) | `src/service/index.ts` |
| Capability identity and lookup (`define`, `resolve`, `require`) | NEXUS | NEXUS (application-side contract) | partial: `Capability.tag` is created and exported but never read | `src/capability/index.ts:3-11`, `:33-42`; grep finds no `.tag` use |
| Capability **provision** (which implementation backs an id) | **application author** (`ApplicationDefinition.environment`) | **platform** | divergent | `src/application/index.ts:35`, `:63-74` |
| `CapabilitySource` vocabulary | NEXUS public type | platform (or absent from the application view) | divergent | `src/capability/index.ts:13` |
| Capability lifetime | none: pre-built values in `Layer.succeed` | undecided (see I-3) | partial | `src/capability/index.ts:31` |
| Capability discovery | NEXUS, as planned future work (docs) | platform supplies it explicitly; NEXUS never discovers | divergent (docs only; nothing is built) | ARCHITECTURE §10.1; `capability.md` Testing |
| Semantic analysis | NEXUS leaf | NEXUS leaf | aligned; "target" terminology ambiguous (F) | `src/semantic/index.ts:1-8`; `tests/architecture.test.ts` |
| MESH host adapter | NEXUS package (`src/mesh`) | integration boundary | aligned (M1–M4); environment-dependent through mesh-runtime (E3) | `src/mesh/index.ts`; E3 |
| PORT | none | PORT | aligned (no leak) | `tests/architecture.test.ts` "no PORT anywhere" |
| Package metadata, CI, test runner | Node-only | tooling; core host-agnostic | partial | `package.json` `engines.node >=22`, `@types/node` visible to `src/`; CI matrix Node 22/24 |

---

## E. Platform coupling inventory

Every environmental assumption found. None of them is a direct host-API call in `src/`: the core is clean by E1 and grep. What follows is indirect coupling.

| # | Location | Current behavior | Why it is platform-specific | Public exposure | Proposed boundary | Resolve in |
|---|---|---|---|---|---|---|
| 1 | `src/application/index.ts:35`, `:63-74`; `src/capability/index.ts:31` | The application definition carries the environment as a map of pre-resolved implementations, wrapped in `Layer.succeed`. | Which implementation backs a capability is a fact about the environment, but the application author supplies it. | `ApplicationDefinition.environment`, `Capability.EnvironmentLive`, `RunningApplication.environment` | Separate *what the application requires* from *what the host/platform supplies*: a platform input at start, not in the definition. | v0.6 |
| 2 | `src/capability/index.ts:13` | `CapabilitySource = "native" \| "browser" \| "remote" \| "fallback"` | Names execution environments inside NEXUS. Application code can branch on `resolution.source`, which is the platform-identity branching `capability.md`'s own rules forbid. | Public type, inside `CapabilityResolution` | Owned by the platform, or removed from the application-facing view (decision I-2). | v0.6 |
| 3 | `src/runtime/index.ts:34` | `Effect.runtime()` captures the calling fiber's FiberRefs, so Effect's default services come from whoever calls `start`/`make`, and the app's layer may also override them (E2). | Clock, Scheduler, Random, Console and Tracer are environment services. Effect's defaults read `setTimeout`, `Date.now`, `performance` and `process.hrtime` (`effect/dist/esm/internal/clock.js`). | Not typed. It is observable behavior. | Keep them as Effect infrastructure (NEXUS doesn't wrap Clock), but name one supply point, the platform/host, and document it (decision I-4). | v0.6 |
| 4 | `package.json`, `tsconfig.json`, `.github/workflows/ci.yml` | `engines.node >=22`; `@types/node` is a dev dependency, and with no `types` field it is visible to `src/`; CI runs Node only; vitest uses the node environment. | Host independence isn't enforced. A Node global in `src/` would typecheck (E1). | The package metadata claims Node. | A core typecheck with `types: []`, plus an architecture test forbidding `node:` and host globals in core. Revisit `engines` once the host requirement is known. | v0.6 (guard); metadata later |
| 5 | `src/mesh/index.ts:18`, `:65`, `:82`; mesh-runtime `dist/engine.js` (E3) | The adapter calls `render`/`dispatch`. mesh-runtime auto-loads its WASM engine only under Node; in a browser the host must call `init(url)`, which NEXUS neither re-exports nor mentions. | Engine loading depends on the host. The v0.2 DoD says "a NEXUS application in Node drives MESH". | `Mesh.host`; `@valancex/mesh-runtime` is a regular dependency | Integration concern: engine initialization belongs to whoever hosts MESH (the platform/integration host), not to NEXUS core. Document it; don't wrap it. | v0.9 / I1 |
| 6 | `src/mesh/index.ts:65`, `:82` | `Effect.promise` around the mesh-runtime calls; mesh-runtime serializes calls through a module-global queue and instance. | Assumes one engine instance per realm, shared by every host. | none | Integration concern, recorded only. | I1 / v0.10 |
| 7 | `src/runtime/internal.ts:50`, `src/application/index.ts:56` | Handles are valid only for the module instance that made them (`WeakMap` registries). | Duplicate package copies (bundler splits, workers, reload/replacement) would refuse each other's handles as "not a runtime NEXUS made". This isn't host-specific, but it assumes one module graph. | Refusal behavior (defect) | NEXUS-owned, and correct today. It matters for replacement/reload (v0.10). | v0.10 (new decision L8) |
| 8 | `src/runtime/index.ts:52-56` | `run` returns a `Promise`. | ECMAScript-standard. It is a host bridge for non-Effect callers, not a platform API. | `Runtime.run` | Keep it. Classify it as an integration bridge. | none |
| 9 | Docs: ARCHITECTURE §1, §10, §10.1, §24, §25.1; `capability.md`; README; FUTURE_DIRECTION §9, §15, §17, I8 | They describe NEXUS resolving *device* capabilities and planning environment *discovery*, and PORT owning physical platform mechanisms. The §24 diagram runs `Effect → Infrastructure / OS`, with no platform. | These contradict the roadmap's platform ownership. | Documentation | Annotated in this change (section L); contracts untouched. | now (docs) |

**Not found:** no global mutable application state beyond the two handle registries; no environment detection in `src/`; no network, storage or filesystem access; no timing assumptions (no `sleep` or `timeout` in `src/`); no implicit resource ownership (every scope is explicit and tested).

---

## F. Capability audit

### What "capability" means today

There are three uses of the word, spread over two concepts in NEXUS and one in PORT.

| Concept | Defined in | Owned by | Consumed by | Level |
|---|---|---|---|---|
| **`Capability` primitive** (`define`/`resolve`/`require`, `Environment`, `CapabilityResolution`, `CapabilitySource`) | `src/capability/index.ts`; ARCHITECTURE §10; `capability.md` | NEXUS type. Its *values* are supplied by the application author | application effects (commands, services) | **Mixed.** The *requirement* side (`define`, `require`) is application-level. The *provision* side (resolutions, `source`) is environment-level, but written into the application definition. |
| **Semantic "target capability"** (`Requirement.capability`, `TargetProfile.provided/notProvided`) | `src/semantic/index.ts`; `semantic.md`; I15, I16 | NEXUS semantic model. Profiles are explicit caller input (D8) | `Semantic.analyze` consumers (none exist yet) | **Ambiguous.** The only worked examples (`profile: "browser"`, `notProvided: ["filesystem"]`) and FUTURE_DIRECTION §9 (Browser/Node profiles: fetch, filesystem, processes) describe **platform** capability. FUTURE_DIRECTION §15/I8 give its physical provision to **PORT**. |
| **PORT target capability** (`retained-rendering`, `stable-native-widget-identity`, …) | PORT `docs/ARCHITECTURE.md` "Two kinds of capability" | PORT | MESH, tooling | **Target** (rendering realization). Not present in NEXUS, correctly. |

Against the roadmap's three kinds:

- **Application capability** (something the application itself can do or requires) exists only as the requirement half of the `Capability` primitive. Nothing models capabilities the application *offers*.
- **Platform capability** (something the environment provides) is today split between the provision half of `Capability`, which lives in the wrong place, and the semantic target profile, which uses the wrong name.
- **Target capability** (something a rendering target can realize) is PORT's. NEXUS has none, which is correct.

### Ambiguities

1. **"Target" means an execution environment in the NEXUS semantic model, and a rendering target in PORT.** The semantic codes (`nexus-incompatible-target-capability`, `nexus-undetermined-target-capability`), `TargetProfile`, `Property = "target-requirements"` and `RequiredFact = "target-compatibility"` are released public contracts. Renaming them would break the diagnostic contract (C6, I13), so v0.6 must not rename them. What they *denote* is open (new decision L6).
2. **I15 separates the identifier spaces of application capabilities and target capabilities.** The roadmap's v0.7 relation (application *requires* capability × platform *provides* capability → supported/opaque/incompatible) needs the application's requirements and a platform's provisions to meet in one space. v0.7 must either revise I15 deliberately or keep the `Capability` primitive and the semantic profile separate and add an explicit mapping. v0.6 must not decide this implicitly.
3. **`CapabilityResolution` is both a platform statement and an application-visible value.** `source` leaks platform identity to application code (E-2).
4. **`Capability.tag` implies Effect-context provision**, but provision is by string id through the `Environment` map. The tag is dead weight in the public data model. It is also a latent collision: `Service.define(name)`, `Capability.define(id)` and the internal tags (`"nexus/Environment"`, `"nexus/EventBus"`) all use `Context.GenericTag` with raw strings.

### What existing APIs depend on it

`Capability.define/resolve/require`, `Capability.Environment`, `Capability.EnvironmentLive`, `EnvironmentShape`, `CapabilityResolution`, `CapabilitySource`, `CapabilityUnavailableError`, `ApplicationDefinition.environment`, `ApplicationAmbient`, `RunningApplication.environment`, and the `R` of `RunningApplication.runtime`. Tests: `tests/capability.test.ts` (5), `tests/application.test.ts` ("resolves Environment before the service graph"), and `tests/lifecycle.test.ts` ("exposes only status, runtime and environment"). The semantic model depends on none of these (I15, D7).

### What should change in v0.6, and what should wait

- **v0.6:** move *provision* out of the application definition into a platform input (E-1); decide `CapabilitySource` (I-2) and capability lifetime (I-3); fix the vocabulary in docs (application capability / platform capability / target capability, and "target" in the semantic model as the open L6). Keep `define`, `resolve` and `require` behaving exactly as today.
- **v0.7:** the requirement × provision relation, and whether it reuses `Semantic` (L6, I15).
- **v0.9 / I1:** any relation to PORT target capabilities (L1).

---

## G. Effect boundary audit

**Where Effect is foundational (correctly so).** Every executable primitive is Effect: `Effect`, `Layer`, `Context`, `Scope`, `Schema`, `Stream`, `SubscriptionRef`, `PubSub`, `Deferred`, `Fiber`. The ARCHITECTURE §2.2 decision holds, and using Effect is not a finding.

**Implementation mechanisms (hidden, and should stay hidden).** These are the Effect `Runtime`, the service `Context` and the runtime `Scope` (N3, pinned by `tests/runtime.test.ts` "the opaque handle"); `SubscriptionRef` inside `State`; `PubSub` inside the bus; `Deferred` and counters in admission; and `Effect.promise` in the adapter.

**Exposed publicly, by design.** `Service<Shape> = Context.Tag`; `ApplicationDefinition.runtime: Layer`; `Runtime.make(layer)`; `runFork → Fiber.RuntimeFiber`; `StateHandle`/`SelectorHandle` as `Effect`/`Stream`; `Schema` in `Command`, `State` and `Event`. These are deliberate and consistent with "NEXUS adds application semantics on top of Effect".

**Where NEXUS semantics and Effect mechanics are mixed (findings):**
1. `EventBusShape` is exported so that `R` can be named, but its members expose `Queue.Dequeue<Envelope>` and a `Scope` requirement. `Envelope` is an internal type. The bus's *semantics* (it closes first, nothing is delivered after close) are NEXUS contracts; its *shape* is a mechanism. Not a v0.6 blocker; record for v0.8/v0.10.
2. `Capability.tag` (F, ambiguity 4) is a mechanism in the public data model with no semantic role.
3. **Effect default services are an undeclared environment input** (E-3, E2). This is exactly where Effect mechanics currently *stand in for* a platform contract without anyone having decided so.
4. `Capability.EnvironmentLive` and `Event.EventBusLive` export Layers. `EventBusLive` is used only by tests: `Runtime.make` builds its own bus.

**Is separation needed?** No wrapper around Effect is needed or wanted. What v0.6 needs is narrower:
- a **named supply point** where a platform provides Effect Layers (default-service overrides and capability implementations), instead of today's implicit inheritance;
- a rule that a platform-provided contract is identified by a NEXUS identity (the capability `id`), with the Effect `Tag`/`Layer` as its mechanism: *NEXUS domain concept → Effect service/context → platform implementation*, as the roadmap says;
- no change to the semantic layer, which already exposes no Effect type (I18).

---

## H. Existing contracts that v0.6 must preserve

These must not be broken by accident. Changing one is a deliberate, documented decision with release notes, as in v0.3's decision 9.

- **Lifecycle (v0.3, ARCHITECTURE §26.9).** There are exactly two termination routes, once each. Status is monotonic (`Created → Initializing → Running → Stopping → Stopped`, or `Failed`). `shutdown` is idempotent and never fails. Only the performer re-raises a release failure (B4). New work is refused as a defect from the moment termination is *requested* (N2, Q1). `createState` is admitted only while `Running` (Q2 = A). The single init error is `ServiceGraphFailed`. Pinned by `tests/lifecycle.test.ts` (23) and `tests/application.test.ts` (4).
- **Runtime.** The handle is opaque (N3); `run`/`runFork` refuse foreign or terminating handles; termination order is bus-then-scope (N1, D4); there is no `shutdown`; `RuntimeInitError = LayerBuildFailed`. Pinned by `tests/runtime.test.ts` (15).
- **Commands.** `Command.invoke` decodes input with Schema; the only added error is `CommandValidationError`; the handler's `E` passes through unchanged; there is no registry.
- **Selectors.** They are pure, `value` plus `changes` (future commits only), and `combine`.
- **State.** Updates are atomic, `set` validates, `changes` carries future commits only and ends when the owning scope closes, and application-owned State ends with the application (D1).
- **Events.** `publish` is type-directed with no decoding (Q3 = B); the bus is per runtime and closes before release; nothing is delivered after close.
- **Resources.** Release happens on success, failure and interruption, scoped to the runtime scope.
- **Capabilities.** `resolve` never fails (unavailable is a value); `require` fails only with `CapabilityUnavailableError`; resolutions are fixed at start; `Environment` is resolved before the service graph, so layers may require it. *(v0.6 may move who supplies resolutions, but not these behaviors, unless a decision says so.)*
- **Semantic analysis.** I11–I27 and D1–D29 hold: a leaf with no imports; plain data; a synchronous, pure `build`/`analyze`; opaque ≠ incompatible (I12); no gating (D10); declarations are standalone (D17); v0.4 results are preserved (I27).
- **Diagnostics.** They are JSON-plain (I13); codes are stable `nexus-*` values with `warning`/`error` only; provenance is exact (I17); rejections are not diagnostics.
- **Provenance.** Supplied spans reach diagnostics unchanged; `Unlocated` is explicit.
- **MESH adapter.** M1–M4 hold, and the error table and `renders` lifecycle in ARCHITECTURE §15 are part of the contract. Pinned by `tests/mesh.test.ts` (14) and the architecture tests.
- **Public package exports.** Exactly `Application, Runtime, Service, State, Selector, Command, Capability, Resource, Event, Mesh, Semantic` (pinned by `tests/architecture.test.ts`). `Semantic`'s runtime exports are exactly `analyze` and `build`, with 35 documented exports (pinned). *The runtime value exports of the nine primitive namespaces are **not** pinned by any test* (see section P).

---

## I. v0.6 blockers

These are the architectural questions that must be answered, in the v0.6 outline, before any boundary-changing code. Each comes from a finding above.

1. **Where is an environment supplied?** Today it is the application definition (capability resolutions) plus the starting fiber and the app's own layer (Effect services, E2). Should `Application.start` take a separate, platform-supplied input, and in what form: a `Layer` that provides `Environment` and service overrides, or data? Is `ApplicationDefinition.environment` kept, deprecated, or removed (a breaking change within v0.x)?
2. **What happens to `CapabilitySource`?** Remove it from the application-facing `CapabilityResolution`, widen it to a platform-owned opaque string, or keep it? Any change is a public-contract change.
3. **Is a platform-provided capability implementation a value or a `Layer`?** Values (today) cannot own platform resources with a lifetime tied to the application's scope. A `Layer` can, but it changes when resolution happens relative to the service graph, which "Environment is resolved before the service graph" pins.
4. **Which Effect default services, if any, are part of the platform contract?** Options: none, documented as Effect's (hosts override them as they wish); or a designated seam at which the platform may override them, with the app's own layer no longer the intended route. Recommendation: keep them as Effect infrastructure, with no NEXUS `Clock` abstraction, and give them one documented supply point.

These do **not** block v0.6. They are recorded so v0.6 doesn't decide them implicitly: L6 (the semantic "target" and I15), L8 (module-instance identity), and mesh-runtime engine initialization (E-5).

---

## J. v0.6 non-goals

v0.6 must not introduce:
- SSR, hydration, streaming or prerendering, or any request scope;
- HMR, or any replacement or reload contract (that is v0.10, L8);
- a browser runtime or any DOM-aware code in NEXUS;
- a native runtime;
- the MESH compiler as a runtime dependency (M4), or any change to the adapter's M1–M4 or error table;
- a PORT dependency or target implementation, or any target-capability vocabulary (L1);
- a tooling framework, CLI, dev server or build integration;
- a universal capability taxonomy or shipped capability identifiers or profiles (D8);
- a NEXUS wrapper around Effect's `Clock`, `Random`, `Console`, `Scheduler` or `Tracer`;
- more than one platform implementation, or a family of platform packages;
- changes to the semantic model's public types or diagnostic codes (the meaning of "target" is L6, for v0.7);
- application semantics (facts about state, commands or resources are v0.8);
- capability requirement analysis (v0.7).

---

## K. Recommended v0.6 work breakdown

The sequence follows from the findings. The steps before step 3 change no behavior.

```text
0. Guardrails (no behavior change; they protect the refactor)
   a. Core host-independence check: typecheck src/ with `types: []` (E1), plus an
      architecture test forbidding `node:` specifiers and host globals in src/ core.
   b. Pin the nine primitive namespaces' runtime value exports, as Semantic's already
      are (H, last bullet).
   c. Characterize E2: a test recording where Effect default services come from today,
      so any change to it is deliberate and visible.
        ↓
1. v0.6 outline (docs/superpowers/specs/…-nexus-v0.6-outline.md), in the existing
   release discipline: decide I-1 … I-4, list amended tests explicitly (as D28 did).
        ↓
2. Terminology: application / platform / target capability in ARCHITECTURE §10 and
   capability.md; "target" in Semantic stays as released, and its meaning stays L6.
        ↓
3. Introduce the supply point: `start` accepts the environment from the host/platform
   (per I-1), additively if possible; the existing definition-level path keeps
   working until the outline says otherwise.
        ↓
4. Move capability provision to that supply point; resolve CapabilitySource (I-2) and
   value-vs-Layer (I-3); remove or justify Capability.tag.
        ↓
5. First platform implementation (see section R, question 8): a headless Node host
   that supplies resolutions and Effect services through the new supply point,
   outside src/ core. Keep it in-repo (for example tests/platform/) until a second
   consumer justifies a package.
        ↓
6. Prove behavior unchanged: the full 287-test suite passes with only the outline's
   listed amendments; the vertical slice and the MESH slice run on the platform from
   step 5; the guardrails from step 0 still pass.
        ↓
7. Docs and release notes: capability.md, application.md, ARCHITECTURE §4/§10/§26,
   docs/releases/v0.6.md.
```

---

## L. Documentation conflicts found (and what this change does)

Historical documents (release notes, `superpowers/specs`, `superpowers/plans`, `style-conversion-report.md`) are **left unchanged**. Future-direction and reference documents are annotated where the revised direction contradicts them. No API is described as existing that doesn't.

| Statement | Where | Conflict | Action in this change |
|---|---|---|---|
| NEXUS is responsible for "environment capabilities"; resolves *device* capabilities | ARCHITECTURE §1, §10; README; `capability.md` | Provision is platform-owned in the roadmap | Pointer notes only; the current API contract is unchanged |
| "Discovering them by inspecting the runtime is the intended future shape" (Capability Discovery) | ARCHITECTURE §10.1; `capability.md` Testing | NEXUS must not discover the environment (ROADMAP §20) | Annotated as superseded |
| Resolution strategies "native, browser, remote, fallback" | ARCHITECTURE §10.1; `CapabilitySource` | Platform vocabulary in NEXUS | Recorded as I-2; the contract is unchanged |
| `Effect → Infrastructure / OS` | ARCHITECTURE §24 diagram | Omits the platform boundary | §25.2 added; the diagram is kept as the v0.x record |
| "The selected execution environment must expose a capability profile" (Browser/Node) | FUTURE_DIRECTION §9 | These are platform capabilities, not PORT target capabilities | Annotated |
| "Port is the physical execution boundary"; "PORT determines how those capabilities are physically provided" | FUTURE_DIRECTION §15 | The roadmap gives environment capabilities to platforms and target realization to PORT | Annotated; I8 revised with its original text kept |
| "A universal platform abstraction … PORT owns physical platform mechanisms" | FUTURE_DIRECTION §17 | Same | Annotated |
| I20–I27 not yet synchronized into FUTURE_DIRECTION §18 | v0.5 outline §12 | A pending documentation follow-up | Synchronized (the text is copied from the v0.5 outline) |
| `Application → NEXUS → detect environment → resolve capability` | PORT `docs/ARCHITECTURE.md` | NEXUS doesn't detect the environment | **Not edited** (another repository); reported here |
| `MESH compiler → MESH IR → NEXUS runtime → PORT (Web)` | PORT `README.md` | Conflicts with NEXUS §16 (PORT sees render trees) and with the roadmap's platform step | **Not edited**; reported here |

No document claims that NEXUS supports SSR or HMR, or that application semantics are mature. ROADMAP §12/§15 already place SSR and HMR outside NEXUS.

---

## M. Semantic layer check

- **Strict leaf: yes.** `src/semantic/index.ts` has no imports, and nothing but the entry imports it (`tests/architecture.test.ts`, the leaf suite). It builds and analyzes with every primitive unimportable (`tests/semantic-no-primitives.test.ts`). It has no runtime, platform, MESH, PORT or target-discovery dependency, and no host global (grep).
- **Opaque still means "cannot establish a fact": yes.** `verdictOf` (`src/semantic/index.ts:391-404`) returns `Incompatible` only for a declared requirement in `notProvided`. Everything else that is undecided is `Undetermined` → `opaque`, and the `nexus-opaque-operation` notes say "The operation still executes normally." Pinned by I12 and the v0.4 corpus.
- **Enough for future capability analysis?** Mechanically, yes. required × provided → supported/opaque/incompatible is exactly what `analyze` computes against a profile. What's missing is not graph machinery. It is (a) a producer that turns an application's capability requirements into declarations, and a platform's provisions into a profile, and (b) the L6/I15 decision on whether these share an identifier space. No semantic graph work is needed for v0.6 or v0.7.

## N. MESH integration check

M1–M4 hold (`src/mesh/index.ts:82-95`; `tests/mesh.test.ts` 3, 4, and "UnmappedCommand"; architecture test "keeps the adapter off the MESH compiler"). The adapter holds no registry, lifecycle or scope. **No contract problem was found.** The only environmental finding is E-5, engine initialization, which belongs to the host and not to the adapter. No redesign is proposed.

## O. PORT assumptions check

NEXUS assumes nothing about rendering targets beyond ARCHITECTURE §16: no dependency in either direction, and PORT sees only MESH render trees. No target concern has leaked into `src/`. The semantic model's word "target" denotes an execution environment, not a PORT target (F, ambiguity 1). Nothing in it assumes PORT semantics, and PORT's capability vocabulary is absent. **L1 must stay unresolved until a real PORT target exists**: the PORT packages are empty (`export {}`).

## P. Tests

**Well protected:** lifecycle and termination ordering (`lifecycle`, `runtime`); resource cleanup on success, failure and interruption (`resource`, `runtime`, `application`); state atomicity and stream ends (`state`); event bus close semantics (`event`); semantic analysis, including purity, JSON plainness, provenance, the v0.4 differential corpus and the no-primitives build (`semantic*`); the MESH adapter against MESH's own slice (`mesh`); the import boundaries (`architecture`).

**Not protected:**
- platform-independent behavior: nothing fails if `src/` uses a host API (E1);
- the primitive public API: runtime exports of the nine namespaces aren't pinned, and the primitive-doc parity (v0.3's N4) is enforced by review, not by a test;
- where Effect default services come from (E2);
- mesh-runtime outside Node (E3). This is correct for now, and belongs in platform or integration tests later.

**Test categories needed once a platform exists:**

```text
core NEXUS tests          platform-independent; must pass with no host types and
    (tests/ today)         under any platform; no node:, no DOM
platform tests            environment-specific; one suite per platform implementation;
                           prove that platform's supply of resolutions and services
integration tests         NEXUS + MESH (today's mesh.test.ts) and, from I1,
                           + platform + PORT; may assume a concrete host
```

Today every test runs in Node, and `tests/architecture.test.ts` and `tests/mesh.test.ts` use `node:fs` as test tooling. That is fine: test tooling isn't core. The split should be introduced when step 5 lands, not before.

---

## Q. Deferred decisions

| Id | Decision | Status | Resolve when |
|---|---|---|---|
| L1 | How NEXUS, PORT and targets relate (X3, X4) | Open | The outline of the first release that integrates a real PORT target together with a platform (I1 at the earliest). Needs a real PORT target. |
| L2 | How declarations attach to NEXUS primitives, and which facts NEXUS states about its own primitives | **Resolved in v0.5 by D17** (declarations are canonical and standalone; no NEXUS knowledge of its own primitives). The roadmap's v0.8 ("what facts can NEXUS expose about an application") **reopens the second half**. | The v0.8 outline must revise D17 explicitly if it attaches facts to primitives. It is not reopened silently here. |
| L3 | What downstream consumers do with an `error` diagnostic | Open | The first release with a real consumer (v0.7 capability mismatch at the earliest) |
| L4 | Identity stability across analysis contexts | Open | When incremental analysis or dev tooling needs it |
| L5 | Producers of declarations and source spans | Open | When source capture is introduced |
| **L6** (new) | What a semantic `TargetProfile`/"target capability" denotes (platform capability, PORT target capability, or neutral), and whether I15's separate identifier spaces survive v0.7's requirement × provision relation | Open | The v0.7 outline. v0.6 must not rename released semantic codes or types. |
| **L7** (new) | Who initializes the MESH engine outside Node (mesh-runtime `init`), and where that responsibility is documented | Open | v0.9 / I1 (a browser host) |
| **L8** (new) | Handle and registry validity across module instances (bundles, workers, replacement/reload) | Open | v0.10 (replacement and reload behavior) |

The v0.6 blockers I-1 to I-4 are deliberately **not** listed as deferred: v0.6 exists to answer them.

---

## R. Answers

**1. What is NEXUS today?** A single TypeScript package, `@valancex/nexus` 0.5.0, built on Effect. It has nine primitives: Application, Runtime, Service, State, Selector, Command, Capability, Resource and Event. It has a fully specified lifecycle: an opaque runtime handle, admission control, and ordered termination that closes the bus, then the scope, then reports `Stopped`. It also has a pure, leaf semantic analyzer (`Semantic.build`/`analyze`: declarations and an explicit profile go in; a plain-data IR, supported/opaque/incompatible and diagnostics come out) and a thin MESH host adapter over `@valancex/mesh-runtime`. It has only ever run in Node. It has no platform concept: the application definition carries its environment as pre-resolved capability implementations, and Effect's default services are inherited from whoever starts it.

**2. Where does the current runtime leak platform concerns?** Through indirect coupling, not host API calls (section E):
- `ApplicationDefinition.environment` (E-1) and `CapabilitySource` (E-2);
- implicit inheritance of Effect default services (E-3, E2);
- no enforcement of host independence, with Node-only metadata and CI (E-4, E1);
- mesh-runtime's Node-only automatic engine loading reaching the adapter (E-5, E3);
- documents that give environment discovery to NEXUS and physical platform provision to PORT (E-9).

**3. What should belong to platform packages?** Candidates:
- supplying capability implementations (today's resolution map);
- any source or provenance label for them (today's `CapabilitySource`);
- the choice and override of Effect's Clock, Scheduler, Random, Console and Tracer for a host;
- environment-specific resources behind capabilities, such as sockets, storage and devices, with their lifetimes;
- host-specific initialization, such as the mesh-runtime engine outside Node, *as an integration concern*;
- any later environment detection.

**4. What should remain in NEXUS?**
- application lifecycle, admission and termination order;
- State, Selector, Command and Event semantics;
- Resource scoping semantics;
- the service graph *composition* rule (`Layer`), and the capability *contract*: identity (`id`), `resolve`/`require`, unavailable as a value;
- the semantic model, diagnostics and provenance;
- the MESH adapter's translation contract (M1–M4);
- `Runtime.run`/`runFork` as the host bridge.

**5. How should Effect participate?** As the mechanism, not the vocabulary. A capability is identified by NEXUS (`id` and contract), expressed as an Effect service in `Context`, and supplied as a platform `Layer`. Effect's own default services stay Effect's: NEXUS doesn't wrap them, but it names the one place a platform supplies them. Runtime internals stay hidden (N3). The semantic layer stays Effect-free (I18). `EventBusShape` and `Capability.tag` are the places where mechanism has leaked into public shape, and they are candidates for cleanup, not blockers.

**6. What must change for v0.6?**
- The guardrails in step 0 of section K.
- A v0.6 outline answering I-1 to I-4.
- One supply point for the environment at `start`.
- Capability provision moved there, with decisions on `CapabilitySource` and on value vs `Layer`.
- One headless Node platform outside the core.
- Proof that the existing suite, the vertical slice and the MESH slice are unchanged.

**7. What must explicitly wait?**
- A platform taxonomy or capability vocabulary (v0.7, and never universal);
- SSR, hydration and universal rendering (I1/v0.10, and never as NEXUS modes);
- HMR and replacement (v0.10 as a lifecycle contract, with HMR itself in tooling);
- PORT integration and L1 (I1, against a real target);
- tooling (outside NEXUS);
- application semantics (v0.8, which also means reopening D17).

**8. What is the smallest credible first platform experiment?** A **headless Node host platform** that supplies capability resolutions and Effect default services through the new supply point, with no PORT and no rendering. It runs the existing vertical slice and the MESH slice unchanged. The repository points to this choice:
- Node is the only environment NEXUS has ever run in (tests, CI, example).
- mesh-runtime works there without host initialization (E3).
- Every existing test can serve as the "behavior unchanged" proof.
- PORT has no target implementation to pair with.

A browser experiment would additionally need mesh-runtime `init` (L7) and a PORT web target that doesn't exist, which is I1 territory. The server path in ROADMAP §11 (Node platform → PORT web-server → HTML) is the natural next step once PORT exists, and it reuses this platform.

**9. Is the current architecture ready to begin v0.6 implementation?** **READY**, on these grounds:
- the repository is clean and green (287/287), with no host API in the core (E1);
- the divergence is localized (E-1, E-2, E-3);
- the blockers are four bounded decisions that the v0.6 outline can answer from the evidence here.

The condition: only the step-0 guardrails and the outline start immediately. Steps 3 onward, which change the API, begin after I-1 to I-4 are decided and approved.
