# VALANCE cross-repository integration audit (MESH v0.6.0 · NEXUS v0.8.1 · PORT v0.2.0)

*Audited 2026-09-28, to inform NEXUS v0.9. This document records evidence and makes no decisions. It changes no API.*

The question it answers is this: **what does a real Valance application actually require from its execution environment, and which package should own each responsibility?** The answer is worked out from the code as it is today, not from the roadmap.

Each section keeps four kinds of statement apart:
- **FACT:** what the code, the package metadata or a test run shows.
- **EVIDENCE:** where to check it: a file and symbol, a test, or an experiment below.
- **INTERPRETATION:** a judgment drawn from the facts.
- **OPEN QUESTION:** something the evidence doesn't settle.

A statement given under one label is not repeated as another.

## Method

- **Repositories read:** all of NEXUS `src/`, and every NEXUS test that touches the platform, MESH or capabilities. From MESH: `packages/mesh-runtime/src/` (in full), and in `docs/`, `manual/runtime.md` ("The host", event resolution, updates, obligations) and `guides/integrating-mesh-with-nexus.md`. From PORT: `packages/port-web/src/`, all of `integration/`, and `docs/ARCHITECTURE.md` and `docs/CONTRACT.md`. Also the earlier audits: NEXUS's runtime/platform audit, capability model audit and application-semantics audit, and PORT's integration audit.
- **Commands run:** `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test` in NEXUS and PORT; `npm view` for the published versions; `pnpm why` for the resolved graph.
- **Experiments (X1–X4):** throwaway vitest files. They were run in NEXUS's `tests/`, or in PORT's `integration/test/` (which uses the installed `@valancex/nexus`), and then deleted, so nothing from them is committed. Each one's code is described where it is cited, so it can be re-run.
- **Where this ran:** Node 22.22.2, pnpm 10.33.0, effect 3.22.2 (one copy in each workspace), and jsdom 26 for PORT.

---

## 1. Executive summary

**FACT.**
- All three repositories are at their release tags, and every suite passes:
  - NEXUS: 391 tests in 27 files.
  - PORT: `port-web` 242 tests in 9 files; `integration` 15 tests in 5 files.
- The only code that composes MESH, NEXUS and PORT is PORT's private test workspace, `integration/`. In it, the composer is test code (`integration/test/compose.ts`).
- No integration test starts a NEXUS application with a platform. No command in any composed slice uses a capability. No test runs in a real browser.

**INTERPRETATION.**
- **The ownership model holds under the evidence that exists.** MESH → NEXUS → composer → PORT is clean at the package level:
  - no package imports another beyond what the dependency graph in §13 shows;
  - PORT recovers no application meaning;
  - render-v1 is sufficient for the Web slice.
- **The platform boundary is mostly unexercised, not missing.** The environment-dependent operations the composed application really performs fall into three groups:
  - **Effect's default services.** These are already a platform concern (v0.6 D38/D39).
  - **Loading MESH's WebAssembly engine.** MESH owns the engine. In a browser, a host must call `init`, and no code anywhere calls it.
  - **DOM access and event delivery.** PORT owns these, and the composer supplies the container.

  None of the three is a NEXUS `Capability`. None of them needs a new platform package.
- **One real defect was found (§16, P1).** A default service that a platform sets (for example, `Layer.setClock`) escapes into the fiber that called `Application.start`. In the shape NEXUS's own reference platform uses, it outlives the application. A later application started from the same fiber, with no platform, runs on the earlier platform's Clock (X2–X4). This breaks platform isolation. It is recorded here and not fixed.
- **The smallest real Platform boundary is the one that already exists:** `Application.Platform = Layer<EnvironmentShape, unknown, never>` together with the Effect default services that Layer sets. It needs isolation fixed (P1), and the browser evidence doesn't exist yet. It doesn't need a new abstraction.

---

## 2. Current repository versions

**FACT.**

| Repository | Version | HEAD | Tag at HEAD | Relevant latest commits | Working tree at audit start |
|---|---|---|---|---|---|
| ValanceX/Mesh | 0.6.0 (Cargo workspace, `mesh-runtime`, `mesh-compiler`) | `173a828` | `v0.6.0` | `a8a046f` release v0.6.0; `7fb938e` propText in render trees and event resolution | clean |
| ValanceX/Nexus | 0.8.1 | `2c5933c` | `v0.8.1` | `7f08105` release v0.8.1; `2e1076c` MESH runtime and compiler 0.6 | clean |
| ValanceX/Port | 0.2.0 (`@valancex/port-web` 0.2.0; workspace root 0.2.0) | `725b728` | `v0.2.0` | `11edf47` release v0.2.0; `d3b78a1` adoption setter failure | clean |

Published on npm (checked with `npm view`):
- `@valancex/nexus`: 0.8.0 and 0.8.1. 0.8.1 depends on `@valancex/mesh-runtime ^0.6.0` and `effect ^3.10.0`.
- `@valancex/mesh-runtime`: 0.5.0 and 0.6.0.
- `@valancex/port-web`: 0.2.0.

---

## 3. Current architecture

**FACT.** These are the package-level dependencies, as declared (`package.json`) and as resolved (`pnpm why`):

```text
@valancex/mesh-runtime 0.6.0          (no dependencies; ships mesh-runtime.wasm)
@valancex/mesh-compiler 0.6.0         (build time only; devDependency of NEXUS and PORT's integration)

@valancex/nexus 0.8.1
  ├── effect ^3.10.0
  └── @valancex/mesh-runtime ^0.6.0   (imported only by src/mesh/index.ts)

@valancex/port-web 0.2.0
  └── peer: @valancex/mesh-runtime ^0.6.0   (types only: RenderTree, RenderNode, TextRun, BoundaryValue)

PORT integration/ (private, never published)
  ├── @valancex/nexus, @valancex/port-web (workspace), @valancex/mesh-compiler, @valancex/mesh-runtime, effect, jsdom
  └── test/compose.ts  — the composer: the only code that imports both NEXUS and PORT
```

**EVIDENCE.**
- NEXUS: `tests/architecture.test.ts` checks four things: MESH is imported only by `src/mesh`, no Node builtins are imported, only declared dependencies are imported, and PORT is imported nowhere.
- PORT: `integration/test/boundaries.test.ts` checks against the installed manifests that port-web depends only on `@valancex/mesh-runtime` as a peer, and that NEXUS doesn't depend on PORT. `packages/port-web/test/architecture.test.ts` checks port-web's imports and browser globals.

**INTERPRETATION.** The layering the roadmap draws as `MESH ↓ NEXUS ↓ Platform ↓ PORT ↓ Target` isn't a chain in the code. The code is a star around the composer:

```text
                 build tooling / composer (today: PORT integration tests)
                 │ compiles MPRX; starts NEXUS (optionally with a platform);
                 │ creates the PORT with a container; pairs reports with renders
      ┌──────────┼──────────────────────────┐
      ▼          ▼                          ▼
   MESH       NEXUS app + Mesh.host       PORT Web ──▶ DOM (container.ownerDocument)
   runtime ◀──┘ (render/dispatch)          ▲
      (WASM engine)                        └── render.tree (render-v1), from the composer
                 ▲
                 └── Platform Layer (Environment + Effect default services), given to Application.start
```

The platform supplies only the NEXUS application. PORT receives nothing from it. MESH's engine gets nothing from it either.

---

## 4. Actual vertical slice

This section follows one run of PORT's `integration/test/slice.test.ts`, step by step, using the real symbols.

**FACT.**

| # | Step | Where (file · symbol) | Runs on |
|---|---|---|---|
| 1 | MPRX → template-v1 (build time) | PORT `integration/test/app.ts` · `compileProgram`, which calls `@valancex/mesh-compiler` `compile()` and reads the fixtures with `node:fs` `readFileSync` | Node, test process |
| 2 | Program value | NEXUS `src/mesh/index.ts` · `Program { root, templates: string[], model: string }` | plain data |
| 3 | **Application starts** | `slice.test.ts:25` · `Nexus.Application.start(define({ runtime: Layer.empty }))`, **with no platform**, so the Environment is empty (`src/application/index.ts:78`, `noPlatform`) | caller fiber |
| 4 | **Application state enters** | `slice.test.ts:26` · `Application.createState(running, Team, initialTeam)`, a `SubscriptionRef` in the application's scope (`src/state/index.ts`) | NEXUS, admitted |
| 5 | Scope shaping | `app.ts` · `application()`: `Selector.define(team, ({title, first, second, compact}) => …)` drops `selectedUserId` (an `Option`), because MESH records are exact | NEXUS selector (app code) |
| 6 | Host | `app.ts` · `Nexus.Mesh.host({ program, scope, commands })`. The command table, keyed by `"component/name"`, maps `user-card/selectUser` to `users.select` and `users/refresh` to `users.refresh`, through `Mesh.bind` | NEXUS adapter |
| 7 | **Rendering occurs** | `compose.ts:88` · `Effect.runPromise(host.render)`, then `src/mesh/index.ts:64` `renderSnapshot`, then `@valancex/mesh-runtime` `render()`, then `engine.ts` `enqueue`, `current()` and `mesh_render` in WASM | **Effect's default runtime, outside the application runtime** |
| 8 | render-v1 | `Render.tree`: `RenderTree { format: "mesh-render", version: 1, root }`, with `key`, `component`, `props`, `propText?`, `events` (handler ids) and `children` (`mesh-runtime/src/types.ts`) | frozen plain data |
| 9 | **Target realization** | `compose.ts:89` · `port.draw(render.tree)` → `port-web/src/port.ts` `createWebPort` → `drawChecked` → `doc.createElement` with `doc = container.ownerDocument` | jsdom |
| 10 | Program continuity and drawn render | `compose.ts` · `shown = { host, render }`; `follow(host)` runs `Effect.runFork(Stream.runForEach(host.renders, …port.update…))` | **default runtime**, composer |
| 11 | **Events are received** | `port.ts:275` · `container.addEventListener(type, interact, true)`. `interact` walks the *drawn tree* from the innermost drawn node (MESH §9.9), and builds the payload with the application's `EventRealization.payload(event, element)` (`app.ts:70`: `{x, y}` from `MouseEvent`) | PORT |
| 12 | Report | `port.ts` `report(handler, payload?)` → `compose.ts:56-59`, which uses the **drawn** `render`: `run(host.dispatch(render, handler, payload))` | composer |
| 13 | **Commands are produced** | `src/mesh/index.ts:82` · `Effect.promise(() => meshDispatch(render, handler, payload))`, the MESH `CommandIntent` → the own-key lookup `commands["component/name"]` (M3) → the `Binding` → `Command.invoke` (Schema decode) | inside `run` |
| 14 | **Effects execute** | `slice.test.ts:27` · `run = (e) => Nexus.Runtime.run(running.runtime, Effect.exit(e))`: the application runtime, with admission (`src/runtime/index.ts:42-56`), the event bus and the application's default services | NEXUS runtime |
| 15 | State changes, then a new render | `team.update` → `SubscriptionRef` → `state.changes` → `Selector.changes` → `host.renders` (`Stream.mapEffect` → `renderSnapshot`) → `port.update(later.tree)` keeps each key's DOM node | default runtime, composer |
| 16 | Teardown | `slice.test.ts:51-52` · `app.stop()` (interrupts `follow`, `port.unmount()`), then `Application.shutdown(running)`, in that order, by hand | test |

**Platform and environment access in this run:**
- *Effect default services.* Steps 3–4 and 13–15 use the application runtime. Its Clock, Random and others come from the calling fiber, because no platform was given. Steps 7, 10 and 15's renders use Effect's global default runtime.
- *MESH engine.* In steps 7 and 13, `engine.ts` `isNode()` is true, so the engine loads `mesh-runtime.wasm` through `node:fs/promises`, and uses `WebAssembly.compile`/`instantiate`, `TextEncoder` and `TextDecoder`.
- *DOM.* Steps 9, 11 and 15 reach it only through `container.ownerDocument`.
- *Test helpers.* `until` uses `setTimeout`, and `dom()` constructs jsdom.

**EVIDENCE.** The files and lines are in the table. The whole path is exercised by `slice.test.ts`, which checks two things:
- the HTML after the draw equals `expectedFirstHtml`;
- the intent equals MESH's reviewed `expected/select-first.intent.json`.

It also shows that the same `<img>` node is kept across `update`.

The SSR variant (`ssr.test.ts`) replaces steps 9–10:
- **server:** `realizeHtml(render.tree, primitives)` (`port-web/src/html.ts:91`), called from a separate application;
- **state transfer:** the *test* passes the state as `JSON.stringify(state)`;
- **client:** a second application with the parsed state → `composer.hydrate(host)` → `port.hydrate(render.tree)`.

**INTERPRETATION.** Rendering (steps 7, 10 and 15) runs outside the NEXUS application runtime, while dispatch (steps 12–14) runs inside it. That split comes from the composer, not from NEXUS: `Mesh.Host.render` has `R = never`, so it can run anywhere. §16 (P3) records what follows from it.

---

## 5. MESH responsibilities (as implemented)

**FACT.**
- **The runtime's operations.** `@valancex/mesh-runtime` has three: `render(input)`, `dispatch(render, handler, payload?)` and `init(source)`.
  - `render` validates the program, then the snapshot, then evaluates, and returns a frozen `Render`, whose `tree` is render-v1.
  - `dispatch` evaluates against the render's **own** snapshot, never a newer one.
  - `init` loads the WASM module, and is needed in a browser.
- **The engine:**
  - keeps one module-global instance;
  - serializes every call through a module-global promise `queue`;
  - discards the instance after a trap;
  - checks the module's version.
- **Environment use.** The engine uses `WebAssembly`, `TextEncoder` and `TextDecoder`. It chooses how to load its module with `process.versions.node` (`isNode`). Under Node it reads `node:fs/promises`. Otherwise it uses `fetch`, resolving the URL against `location.href`. Outside Node with no `init`, the first call throws `call init() with the URL of mesh-runtime.wasm before the first render`.
- **What MESH expects of a host.** `mesh-runtime` exports a `Host` interface, which only documents the obligations: "Nothing checks that a host implements this". The obligations (`docs/manual/runtime.md`, "What renderers and hosts must do") are:
  - keep each render while its tree is on screen;
  - dispatch with the drawn render;
  - tell the renderer when a new tree comes from a different program;
  - shape values to the manifest;
  - map intents to commands;
  - treat diagnostics as errors.
- **Event resolution** (§9.9) is MESH's rule, and a renderer implements it.

**EVIDENCE.** `Mesh/packages/mesh-runtime/src/engine.ts` (`isNode`, `bytesOf`, `compileModule`, `current`, `enqueue`), `src/index.ts`, `src/types.ts` (`Host`), and `docs/manual/runtime.md`.

**INTERPRETATION.**
- MESH's single "host" role is split between two parties in practice:
  - **NEXUS's `Mesh.host`** supplies snapshots, calls render and dispatch, and maps intents.
  - **The composer** keeps the drawn render, relays reports, and tells PORT whether the program changed.
- NEXUS doesn't implement MESH's `Host` interface, and shouldn't: M2 forbids a render registry. The composer's `shown` variable plays the part of `keep`, and its `report` callback plays the part of `relay`.
- MESH's guide still says "the adapter … keeps each render". That is documentation drift (§16, P4), not a defect.

---

## 6. NEXUS responsibilities (as implemented)

**FACT.**
- **Application lifecycle.** An application's status moves `Created → Initializing → Running → Stopping → Stopped`, or to `Failed`. It stops only through `Application.shutdown` or by closing the start scope (`src/application/index.ts`, `src/runtime/internal.ts`).
- **Admission.** `Runtime.run`/`runFork` and `admit` refuse new work once termination has been claimed.
- **Termination order.** The claim, then draining admitted work, then `Stopping`, then the bus closes, then the scope closes, then `Stopped`.
- **Platform.** `Application.start(app, { platform })`, where `Platform = Layer<EnvironmentShape, unknown, never>`. It is provide-merged *under* the application's `runtime` Layer (`src/application/index.ts:50,98`).
- **Service graph.** It is an Effect `Layer`, built by `Runtime.make` with `Layer.buildWithScope` **in the calling fiber**. The Effect runtime is then captured with `Effect.runtime()` (`src/runtime/index.ts:24-36`).
- **Other primitives:**
  - State: `SubscriptionRef` plus a Schema.
  - Selector: `value` plus `changes`.
  - Command: a Schema-validated handler.
  - Event: a PubSub bus that closes first.
  - Resource: `acquireRelease`.
  - Service: a `Context.Tag`.
- **Capability.**
  - `Capability.define(id)`, `resolve` and `require`. Resolution is a lookup by id in the `Environment` map (`src/capability/index.ts`).
  - NEXUS names no source or environment (v0.6 D32/D33).
- **Semantic.** A pure leaf with no imports. `build` and `analyze` compare declarations against a profile, and nothing gates on the result (`src/semantic/index.ts`; ARCHITECTURE §16.1).
- **MESH adapter** (`src/mesh/index.ts`):
  - `host({ program, scope, commands })` returns `{ render, renders, dispatch }`;
  - `bind(command, toInput)` makes a `Binding`;
  - it keeps no render registry (M2), and only explicit own-key bindings reach behavior (M3);
  - a rejection from the runtime is a defect (`Effect.promise`), and a diagnostic is a typed `MeshDiagnostics` failure.
- **Environment in `src/`:** none. `tsconfig.json` builds `src/` with `types: []` and `lib: ["ES2022"]`, so there are no DOM or Node types. `tests/architecture.test.ts` forbids Node builtins.

**INTERPRETATION.** NEXUS's own execution needs nothing from the environment beyond an ES2022 realm and Effect. Its one indirect environment dependency is the adapter's call into mesh-runtime, which inherits MESH's engine loading.

---

## 7. PORT responsibilities (as implemented)

**FACT.**
- **`@valancex/port-web` (client)** provides `createWebPort({ container, primitives, report })`, which returns `{ draw, update, hydrate, unmount }`.
  - Every DOM object comes from `container.ownerDocument`. It uses no browser globals, which a test checks.
  - Its listeners are capturing listeners on the container, one per DOM event type the table maps.
  - It resolves events by MESH §9.9, walking the drawn tree, not relying on DOM bubbling.
  - Values are realized through an explicit, per-application table: `attribute`, `textProperty`, `booleanAttribute` and `property(name, kind)`.
  - It uses `propText` for text-only slots.
  - Hydration is structural, and a mismatch means a fresh draw.
- **`@valancex/port-web/server`** provides `realizeHtml(tree, primitives)`, which returns a string. It is DOM-free, and a test checks its module graph.
- **Reports.** PORT reports `(handler, payload?)` only. It never sees a `Render`, an intent, a command or NEXUS.

**EVIDENCE.** `Port/packages/port-web/src/port.ts` (`createWebPort`, `interact`, `listen`), `html.ts`, `primitives.ts`, `check.ts`; `test/architecture.test.ts` ("uses no browser globals", "constructs no object of a platform realm", "uses no DOM API at run time" for the server entry).

**INTERPRETATION.**
- Everything in port-web is a genuine PORT concern: DOM, HTML, events and hydration.
- Its only environmental input is the container, and through it the document and the realm. It is given that input, and never looks it up.
- **The payload builder** (`EventRealization.payload`) is application-authored code, and it runs inside PORT. It turns a target event into MESH's declared payload type (for example, a `Press`). That is target-specific, and MESH validates the result at dispatch. So it isn't application semantics that PORT recovers; it's the target half of an event contract that MESH declares.

---

## 8. Composer / integration responsibilities (as implemented)

**FACT.** The composer, `Port/integration/test/compose.ts`, together with its call sites, currently owns the following:
- **Build.** Compiling MPRX to template-v1 (`app.ts` `compileProgram`), and reading the fixtures and manifest from the filesystem.
- **Wiring.** Choosing the NEXUS application, its state and command bindings (`app.ts` `application`), and the Web realization table (`app.ts` `primitives`).
- **The container.** Creating the document and choosing the container (`app.ts` `dom()`, with jsdom).
- **Program continuity.** `show` draws, `hydrate` hydrates, and each later render is an `update` (`follow`).
- **Keeping the drawn `Render`,** and pairing each report with it (`shown.render`).
- **Where dispatch runs.** This is the `run` parameter, which the tests set to `Runtime.run(running.runtime, Effect.exit(…))`.
- **Where renders run.** They run on Effect's default runtime (`Effect.runPromise(host.render)`, `Effect.runFork(…host.renders…)`).
- **Teardown order.** `app.stop()` then `Application.shutdown`, done by hand in each test.
- **SSR state transfer.** `JSON.stringify(state)` into the page, then `JSON.parse` on the client (`ssr.test.ts` `serve`).
- **Dispatch outcomes.** They are only recorded (`dispatched`), with no policy for `MeshDiagnostics`, `UnmappedCommand` or command failures.

**INTERPRETATION.**
- The composer holds exactly the facts that NEXUS and PORT each correctly refuse to hold: program continuity, the drawn render, and the container. That confirms the boundary rather than showing a leak.
- The composer is **test code in PORT's private workspace**. It is the only implementation, it isn't published, and nothing tests it outside those scenarios. Every application would have to rewrite it. See OPEN QUESTION Q1 in §20.

---

## 9. Environment / platform responsibilities (as implemented)

**FACT.**
- **Platforms that exist:**
  - NEXUS `tests/platform/reference.ts`, `referencePlatform({ resolutions?, clock? })`, which is `EnvironmentLive(map)`, optionally merged with `Layer.setClock`;
  - ad hoc `Layer`s in NEXUS tests.

  No other platform exists. No platform package exists in any repository.
- **Platforms in integrations:** none. No PORT integration test passes `{ platform }`. NEXUS `tests/mesh.test.ts` test 9 runs the MESH round trip with a reference platform. That test resolves a probe capability separately; the command it dispatches uses no capability.
- **What a platform can supply today:**
  - capability resolutions, through `Environment`;
  - Effect default services, as a FiberRef side effect of its Layer's build;
  - scoped resources, which are acquired first and released last.

**EVIDENCE.** `grep -rn platform Port/integration/test` finds nothing. The test is `Nexus/tests/mesh.test.ts:454-480`. The lifetime tests are in `tests/platform.test.ts`.

**INTERPRETATION.** The platform boundary exists and has been tested in isolation inside NEXUS. **It has never been part of a composition with MESH and PORT.** Nothing the composed slice does needs a capability.

---

## 10. Effect infrastructure responsibilities

**FACT.**
- **Default services.** Effect 3.22's are `Clock`, `Console`, `Random`, `ConfigProvider` (the default reads `process.env`) and `Tracer`. The `Scheduler` is a FiberRef. NEXUS names none of them (v0.6 D38).
- **Precedence** is the caller's fiber, then the platform, then the application layer (D39). `tests/default-services.test.ts` pins that order.
- **Where each part runs:**
  - The application runtime captures its FiberRefs from the fiber that builds it.
  - Rendering, in the composer, runs on Effect's global default runtime.
  - NEXUS core reads no default service: no `Clock`, `sleep` or `Random` appears in `src/`.

**EVIDENCE.**
- `src/runtime/index.ts:32-34`; `tests/default-services.test.ts`.
- **X2, X3:** a platform's `Layer.setClock` escapes into the caller's fiber.
- **X4:** that Clock reaches a second application.

Both experiments are described in §16 under P1.

**INTERPRETATION.**
- Effect default services are the one environment concern the running code actually touches: effect's defaults call `Date.now` and `setTimeout`, among others. They are correctly Effect's, and correctly supplied by a platform.
- The seam is sound in direction: a platform sets the services, and NEXUS doesn't name them. It is **not isolated** (P1).

---

## 11. Ownership classification table

**Classifications:** NEXUS-owned, MESH-owned, PORT-owned, Platform-owned, Effect infrastructure, Composer/integration concern, and Unknown. "Current owner" is the code that does it today. "none" means no code does it.

| Concern | Current owner | Evidence | Proposed ownership | Confidence |
|---|---|---|---|---|
| Clock / time | Effect default service, supplied implicitly by the calling fiber, or by the platform or application layer | `src/runtime/index.ts:34`; `tests/default-services.test.ts`; X2–X4 | **Effect infrastructure** (a platform sets it). Isolation is a defect: P1 | High |
| Fiber scheduling and timers | Effect (the Scheduler FiberRef; the default uses `setTimeout`) | the Effect runtime; no scheduling in `src/` | **Effect infrastructure** | High |
| Render scheduling (when to re-render) | the composer: one render per state commit, sequential (`host.renders` = `Stream.mapEffect(scope.changes)`) | `src/mesh/index.ts:80`; `compose.ts:65` | **Composer/integration concern**. NEXUS gives the stream, and the composer decides when to draw | Medium (no batching or frame evidence exists) |
| Randomness | Effect default service; unused anywhere | grep: no `Random` in `src/`, port-web or integration | **Effect infrastructure** | Medium (unused) |
| Application networking | none | no code; capability ids appear only in tests (`reference.probe`, `acme.*`) | **Platform-owned**, reached through a NEXUS `Capability` (v0.6 decision) | Low: nothing implements it |
| Fetching the MESH WASM module (browser) | MESH (`engine.ts` `bytesOf` → `fetch`) | `mesh-runtime/src/engine.ts` | **MESH-owned** | High |
| Storage | none | no code, no test, no capability id | **Unknown.** Missing: any application or integration that persists anything | — |
| Filesystem (runtime) | MESH, for its own module under Node only (`node:fs/promises`) | `engine.ts` `bytesOf` | **MESH-owned** | High |
| Filesystem (build: MPRX sources, manifest) | the composer (tests, `readFileSync`) | `app.ts` `read`; NEXUS `tests/mesh.test.ts` | **Composer/integration concern** (build tooling) | High |
| Environment variables | Effect `ConfigProvider` default (`process.env`); unread | grep: no `Config` use | **Effect infrastructure** | Medium (unused) |
| JS realm facilities (`WebAssembly`, `TextEncoder`/`TextDecoder`, `process` detection, `location`) | MESH engine | `engine.ts` | **MESH-owned** | High |
| MESH engine initialization in a browser (`init(url)`) | **none**: no call anywhere in NEXUS or PORT | grep for `init(` over `Nexus/src`, `Nexus/tests`, `port-web/src` and `integration/test`: no match | **Composer/integration concern** (it holds the asset URL and the realm). Not NEXUS: the v0.6 audit's E-5 already says "don't wrap it" | Medium: no browser run exists to confirm it |
| DOM access | PORT (`container.ownerDocument` only) | `port.ts` header; port-web architecture test | **PORT-owned** | High |
| Document and container provisioning | the composer (`dom()`) | `app.ts` | **Composer/integration concern** | High |
| HTML generation | PORT (`realizeHtml`) | `html.ts:91` | **PORT-owned** | High |
| Serving HTML (an HTTP response) | none | no server code | **Unknown.** Missing: any server program. `realizeHtml` returns a string, and nothing sends it | — |
| SSR state transfer (serialize, embed, parse) | the composer (test: `JSON.stringify`) | `ssr.test.ts` `serve` | **Composer/integration concern** | Medium: one test |
| DOM event capture and MESH event resolution | PORT (`interact`, capturing listeners) | `port.ts:243-275` | **PORT-owned** (the rule is MESH-owned, §9.9) | High |
| Event payload construction | application-authored `EventRealization.payload`, run by PORT | `primitives.ts`; `app.ts:70` | **PORT-owned** mechanism, with target configuration supplied by the composer | High |
| Pairing a report with the drawn render | the composer (`shown.render`) | `compose.ts:56-59`; MESH runtime manual, "The host" | **Composer/integration concern** | High |
| Handler id → command intent | MESH (`dispatch`) | `mesh-runtime` | **MESH-owned** | High |
| Intent → NEXUS command | NEXUS adapter (explicit `commands` table, M3) | `src/mesh/index.ts:86-95` | **NEXUS-owned** | High |
| Application lifecycle | NEXUS | `src/application`, `src/runtime/internal.ts` | **NEXUS-owned** | High |
| Resource lifecycle (application resources) | NEXUS over Effect `Scope` | `src/resource`; `tests/platform.test.ts` (ordering) | **NEXUS-owned** | High |
| Coordinating the PORT's lifetime with the application's | the composer, by hand (`app.stop` then `shutdown`) | `slice.test.ts:51-52` | **Composer/integration concern** | Medium: nothing couples them, and whether anything should is open (Q3) |
| State | NEXUS | `src/state` | **NEXUS-owned** | High |
| Commands | NEXUS | `src/command` | **NEXUS-owned** | High |
| Selectors, and shaping to the manifest | NEXUS primitive; the shaping is application code | `app.ts` `application` scope selector | **NEXUS-owned** | High |
| MESH rendering (evaluation) | MESH | `mesh-runtime` | **MESH-owned** | High |
| Where `host.render` / `host.renders` run | the composer (Effect's default runtime) | `compose.ts:65,88,102` | **Unknown.** Missing: a decision on whether rendering is application-admitted work (P3, Q2) | — |
| Compiling MPRX | the composer / build (`mesh-compiler`) | `app.ts` `compileProgram` | **Composer/integration concern** (build tooling) | High |
| Program continuity | the composer | PORT CONTRACT "Program continuity" | **Composer/integration concern** | High |
| PORT realization (draw, update, hydrate) | PORT | `port.ts` | **PORT-owned** | High |
| Platform capability discovery | none. NEXUS never discovers (v0.6 D32/D33); no platform exists | `src/capability`; `tests/platform.test.ts` "names no execution environment" | **Platform-owned** | Medium: no real platform exists |
| Capability provision (the `Environment` Layer) | test platforms only | `tests/platform/reference.ts` | **Platform-owned** | High for the direction; there is no real implementation |
| Capability requirement declarations (the model) | NEXUS `Semantic`; producers are tests only | `tests/capability-model.test.ts`, `tests/application-semantics.test.ts` | **NEXUS-owned** (the model). Who produces the declarations is open (O11/O13) | High for the model |
| Effect services and layers (the service graph) | Effect, orchestrated by NEXUS (`Layer.provideMerge`, `buildWithScope`) | `src/application/index.ts:98`; `src/runtime/index.ts:32` | **Effect infrastructure** | High |
| The event bus | NEXUS | `src/event` | **NEXUS-owned** | High |
| Dispatch outcome policy (diagnostics, unmapped commands, command errors) | the composer records the `Exit`; there is no policy | `compose.ts` `dispatched` | **Composer/integration concern** | Medium |
| Serializing calls into the MESH engine | MESH (module-global `queue`, one instance per realm) | `engine.ts` `enqueue` | **MESH-owned** | High |
| Handle and module identity (WeakMap registries) | NEXUS | `src/runtime/internal.ts:50`; `src/application/index.ts:75` | **NEXUS-owned** | High |

**INTERPRETATION.** Every concern the running code actually exercises has a clear owner. The Unknowns are storage, serving HTML, and where rendering runs. They are unknown because no code does them yet, not because two packages disagree about them.

---

## 12. Current capability model audit

**FACT.**
- **What declares requirements.** Only NEXUS test fixtures build `Semantic` declarations: `tests/capability-model.test.ts`, `tests/application-semantics.test.ts` and `tests/semantic*.test.ts`. No application code, example or integration declares any.
- **What provides capabilities.**
  - At runtime: test platforms, namely `referencePlatform` and ad hoc `EnvironmentLive` maps.
  - Statically: provision statements (a `TargetProfile`) written in tests, and checked against a platform by the test-only `tests/platform/conformance.ts`.
  - The PORT integration provides none: it passes no platform, so the Environment is empty.
- **What consumes capabilities.** `Capability.require` and `resolve`, in NEXUS tests. No command in any composed slice, in NEXUS `mesh.test.ts` or in PORT `integration/`, consumes a capability.
- **Runtime resolution and semantic analysis are separate.**
  - `src/semantic/index.ts` imports nothing.
  - Nothing under `src/` except the entry imports it (`tests/architecture.test.ts`, "the semantic model is a leaf").
  - No start, admission, run or dispatch reads an analysis result (semantic.md, "No gating").
  - `Capability.resolve` reads only the `Environment` map.
- **Primitive values carry no requirement.** `Command.define` and `Application.define` add no field, and `ApplicationDefinition` is exactly `{ name, runtime }` (`tests/application-semantics.test.ts`, I39). `Semantic` builds and analyzes with every primitive unimportable (`tests/semantic-no-primitives.test.ts`).
- **What the v0.8 units cover.** Their *admitted unit* is "an effect run through `Runtime.run` or `Runtime.runFork`". In the composed slice, the one admitted effect per interaction is `host.dispatch(render, handler, payload)`: MESH's dispatch, then the binding, then the command. `host.render` and `host.renders` are never admitted (§4, step 7).

**EVIDENCE.** The files are named above. There is also X1: `host.render` succeeds after `Application.shutdown`, while `Runtime.run(... host.dispatch ...)` after shutdown is refused with "NEXUS: the runtime has begun terminating".

**INTERPRETATION.**
- **No existing implementation violates the model's boundaries.** Requirements live in standalone declarations, provision lives in a platform Layer plus its statement, and analysis stays static.
- **For today's integration, no change to capability requirements is needed.** The composed application needs no capability. What it does need from the environment is the MESH engine, a DOM container and Effect's default services. None of those is an application capability, and none of them should be modeled as one:
  - the engine is a precondition of the adapter module;
  - the container is PORT input that the composer supplies;
  - the default services are Effect infrastructure.
- **Question G: what the model can't represent cleanly.** Two things fall outside it, and in both cases the model is right to leave them out:
  1. *A default service that a platform supplies* (for example, a deterministic Clock). A provision statement names `Capability.id`s only. Neither `conformance` nor `Semantic` can state "this platform sets the Clock" or check it. Nothing in the code requires them to.
  2. *Rendering as a unit.* Rendering isn't admitted work, so no v0.8 unit describes it. It needs no capability today, so the gap is harmless. If rendering ever needed one (for example, a formatting service), the model would have no unit to attach it to. See Q2.
- **The model is sufficient for the current integration and needs no change.** It is untested *in* a composition. The first composed use of a real capability is missing evidence (§15).

---

## 13. Current cross-package dependency graph

**FACT.** This is the graph as resolved in PORT's workspace, after this audit's cleanup (§ Appendix A):

```text
@valancex/port-integration (private)
├── @valancex/nexus 0.8.1 ── @valancex/mesh-runtime 0.6.0, effect 3.22.2
├── @valancex/port-web (workspace) ·· peer @valancex/mesh-runtime ^0.6.0 → 0.6.0
├── @valancex/mesh-runtime 0.6.0          ← one copy (pnpm why: "Found 1 version")
├── @valancex/mesh-compiler 0.6.0
└── effect 3.22.2                         ← one copy
```

In NEXUS's own workspace, `@valancex/mesh-runtime` is 0.6.0 and `@valancex/mesh-compiler` 0.6.0 is a devDependency.

**Release compatibility.**
- **The problem.** PORT v0.2.0's workspace root carried `pnpm.overrides: { "@valancex/nexus>@valancex/mesh-runtime": "^0.6.0" }`, because NEXUS 0.8.0 declared `^0.5.0`.
- **What changed.** NEXUS 0.8.1 is published and declares `^0.6.0`.
- **The cleanup.** The override was removed. The integration's `@valancex/nexus` range moved from `^0.8.0` to `^0.8.1`, so without the override it can't resolve 0.8.0 and a second `mesh-runtime` (0.5.x).
- **Checks.** The lockfile then resolves `@valancex/nexus@0.8.1` → `@valancex/mesh-runtime@0.6.0`, one copy. `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test` all pass: port-web 242, integration 15.

**INTERPRETATION.**
- **Why the range moved.** Keeping `^0.8.0` without the override would still resolve correctly from the lockfile. But a fresh resolution could legally pick 0.8.0 and install two engines. Each engine has its own module-global instance and queue. A `Render` made by one copy passes the other's `Render.inputsOf` brand check only if it's the same class, so it would fail with a `TypeError`.
- **Scope of the change.** The cleanup affects only the private test workspace, and doesn't change `@valancex/port-web`. It can be released on its own, or not released at all: the workspace is private.

---

## 14. Existing integration evidence

**FACT.** The strongest cross-repository evidence is PORT's `integration/` (15 tests), and in particular:
- `slice.test.ts` (1 test): the full loop. MPRX → compiler → runtime → NEXUS → composer → PORT → jsdom → click → NEXUS command → state → re-render → in-place update. It is checked against MESH's reviewed intent and the exact HTML.
- `ssr.test.ts` (4 tests): `realizeHtml` → parsed page → client application → `hydrate` → click → update. It also covers the mismatch fallback, and checks that the server entry runs in a Node process with no DOM.
- `composer.test.ts` (2 tests): dispatch uses the drawn render, and a new program is drawn afresh. It also shows that the old render with the new program's handler is refused by MESH (`runtime-handler-other-program`).
- `mesh-v06.test.ts` (4 tests): `propText` in a text-only slot, refusal before the DOM changes, and event resolution with nested bindings.
- `boundaries.test.ts` (4 tests): the dependency directions, and the server entry's module graph.

NEXUS's `tests/mesh.test.ts` (26 tests) adds the adapter's M1–M4, diagnostics and render streams, and test 9, the round trip on a reference platform.

**What it proves:**

| Category | Proven | Not proven |
|---|---|---|
| **Semantic correctness** | the intents equal MESH's reviewed intents; values reach the DOM per §9.8.7; event resolution per §9.9 | anything beyond the MESH slice: two templates, two commands, no lists, no conditionals beyond the fixture |
| **Runtime correctness** | commands run admitted on the application runtime; state leads to re-rendering; teardown works in the tested order; dispatch after shutdown is refused (X1) | concurrent interactions; a render that arrives while a dispatch is in flight; errors raised inside commands and reaching the composer; teardown in any other order; long-lived runs |
| **Platform isolation** | nothing in the composed slice: **no platform is ever passed** | a platform in a composition; default-service isolation (**fails**: X2–X4); capability use by a composed command |
| **Target realization** | DOM and HTML realization in **jsdom**; hydration adoption and mismatch | a real browser: real event dispatch, real layout-dependent payloads (`clientX`), real HTML parsing by a browser, `init()` of the MESH engine, loading `mesh-runtime.wasm` over HTTP |
| **Cross-package compatibility** | the published NEXUS, the published MESH 0.6 and the workspace port-web, with one copy of `effect` and of `mesh-runtime` | a NEXUS or PORT consumer outside PORT's workspace; bundlers; duplicate package copies (the WeakMap registries and MESH's `Render` brand) |

**INTERPRETATION.** The integration tests prove the **wiring contract**: what crosses each boundary, and that the composer's two facts are necessary and sufficient for the slice. They don't prove that a real application runs in a real environment. The existence of `slice.test.ts` must not be read as validation of the platform boundary, which it never touches.

---

## 15. Missing evidence

**FACT.** None of the following exists in any repository:
1. a run in a real browser, or any non-Node realm;
2. a call to `@valancex/mesh-runtime`'s `init`;
3. a composition that passes `{ platform }` to `Application.start`;
4. a command in a composition that consumes a capability;
5. a platform that sets a default service in a composition;
6. a composer outside test code;
7. an HTTP server that serves `realizeHtml` output;
8. storage or network use by any application;
9. an application with more than one concurrently shown host;
10. an error policy for dispatch failures.

**INTERPRETATION.** Items 1–5 are what the roadmap's v0.9 and I1 need. They are cheap to produce. Chromium and Playwright are available in this environment, and the slice already exists. Items 6–10 are outside what the current evidence can decide, and they should wait until 1–5 exist.

---

## 16. Architectural problems

### P1. A platform's default services escape into the caller's fiber, and can outlive the application. **Wrong.**

**FACT.**
- `Runtime.make` builds the application's Layer with `Layer.buildWithScope` in the fiber that calls `Application.start` (`src/runtime/index.ts:32`).
- `Layer.setClock` (and the other default-service layers) are FiberRef-locally-scoped layers. They change the FiberRefs of the fiber that builds them.

**EVIDENCE.**
- **X2.** The platform is `Layer.merge(EnvironmentLive(map), Layer.setClock(c42))`. While the application runs, the caller's fiber reads Clock 42, and so does a child fiber forked from it. An unrelated `Effect.runPromise` doesn't. **After `Application.shutdown`, and after the start scope closes, the caller's fiber still reads 42.**
- **X3.** In the same probe, against NEXUS's `src/`, with the Clock in the application's `runtime` layer instead of the platform: the caller reads 42 while the application runs, and the Clock is restored after shutdown.
- **X4.** Application A is started with `referencePlatform({ clock: c42 })`, NEXUS's own test platform (it uses `Layer.merge`), then shut down and its scope closed. Application B is started afterwards from the same fiber, **with no platform**. B's `Runtime.run(Clock.currentTimeMillis)` returns **42**.
- **Control (part of X3; pure Effect, no NEXUS).** `Layer.buildWithScope(Layer.merge(Layer.empty, Layer.setClock(c42)), scope)`, then `Scope.close`: the caller still reads 42. The same with `Layer.provideMerge` restores the Clock. So the persistence comes from Effect's `merge`. NEXUS exposes it by building in the caller's fiber.

**INTERPRETATION.**
- **What it breaks.** This contradicts v0.6 C15/I31, which say a platform is acquired first and released last and doesn't outlive the application. It also contradicts platform isolation: a platform's environment reaches the host program (in the slice, the composer and the test) and later applications.
- **Why no test caught it.** `tests/default-services.test.ts` pins precedence *into* the application, and never checks the reverse direction.
- **Why nothing has failed yet.** No composition uses a platform, and no NEXUS test starts two applications in sequence from one fiber with different default services.
- **Severity.** The effect is real but has limits: it's observable only through Effect default services. Capability resolution is unaffected, because it's a Context lookup, not a FiberRef.
- **Status.** Not fixed in this audit.

### P2. The browser path of the MESH engine has no owner in the composition. **Incomplete.**

**FACT.**
- Outside Node, `mesh-runtime` throws on the first `render` unless `init(source)` was called.
- `Mesh.host.render` wraps that call in `Effect.promise`, so it would be a **defect** (a die), not a typed error.
- No code calls `init`.

**INTERPRETATION.** MESH designed this seam, and it is correct. The owner should be the composer, which knows the asset URL. This needs documenting and a real browser run. It doesn't need a NEXUS API: the v0.6 audit's E-5 says not to wrap it.

### P3. Rendering isn't governed by the application's lifecycle or runtime. **Ambiguous.**

**FACT.**
- `host.render` and `host.renders` have `R = never`.
- The composer runs them on Effect's default runtime.
- `host.render` succeeds after `Application.shutdown` (X1).
- `host.renders` ends when the State's scope closes, because `State.changes` is interrupted then (`src/state/index.ts:48`).

**INTERPRETATION.**
- Rendering is pure evaluation, plus the MESH engine. So running it outside admission is harmless today.
- It does mean the platform's default services don't apply to rendering, P1's leak aside, and that no v0.8 unit describes it.
- Whether this is correct is a decision, not a defect (Q2).

### P4. Documentation drift about who "the host" is. **Ambiguous (documentation only).**

**FACT.**
- MESH's `guides/integrating-mesh-with-nexus.md` says the adapter lives in NEXUS and "keeps each render".
- NEXUS's adapter keeps no render (M2).
- PORT's CONTRACT assigns keeping the render to the composer.

**INTERPRETATION.** The code is consistent: the composer keeps the render. MESH's guide predates the composer's naming. It should say "host = NEXUS adapter + composer", as a docs-only MESH change. It was not changed here, because MESH changes are out of scope.

### P5. PORT's ARCHITECTURE describes NEXUS as detecting the environment. **Wrong (documentation only).**

**FACT.**
- `Port/docs/ARCHITECTURE.md`, "Two kinds of capability", says: "NEXUS resolves it once … `Application → NEXUS → detect environment → resolve capability`".
- NEXUS v0.6 D32/D33 says NEXUS never detects or discovers. A platform supplies the Environment.

**INTERPRETATION.** The PORT document is stale. It should be a docs-only fix in PORT. It was not changed here, because it isn't the justified dependency cleanup.

### P6. The composer only exists as test code, and its report path doesn't handle a refused dispatch. **Incomplete.**

**FACT.**
- `compose.ts:59` is `pending.push(run(...).then((exit) => …))`, with no rejection handler.
- `run` rejects when the runtime refuses work: after shutdown, X1 shows "the runtime has begun terminating".
- An interaction that happens after `Application.shutdown` but before `composer.stop()` therefore leaves a rejected promise. It surfaces only if something awaits `settled()`, and otherwise becomes an unhandled rejection.
- The tests avoid this by stopping the composer first.

**INTERPRETATION.** This is a property of test code, not of any package. It shows that teardown ordering between the application and the PORT is an unowned composer concern (Q3).

No boundary violation was found between the packages: none recovers another's semantics, imports across a forbidden direction, or relies on another's internals.
- **PORT's use of MESH.** PORT uses only the render-v1 types, `propText`, and opaque keys and handler ids, as MESH specifies them.
- **NEXUS's use of MESH.** NEXUS uses only `render`, `dispatch` and the public types.

---

## 17. Things that should explicitly NOT be changed

**INTERPRETATION** (each item is supported by the evidence above):
- **render-v1.** It was sufficient for every Web path exercised, including draw, update, hydrate, SSR and event resolution. PORT relies on no MESH implementation detail.
- **The dependency directions.** NEXUS doesn't depend on PORT, and PORT doesn't depend on NEXUS. PORT has MESH's runtime only as a type peer.
- **NEXUS M1–M4.** No render registry, dispatch with the caller's render, explicit bindings only, runtime not compiler. The composer holding the drawn render is the design working, not a gap.
- **Program continuity is the composer's.** It must not be inferred by PORT or NEXUS.
- **The capability model.** No metadata on primitives, requirements only in standalone declarations, analysis separate from resolution, and no gating. No change is required for integration.
- **`Platform = Layer<EnvironmentShape, unknown, never>`** as the only start input (D42).
- **No platform packages** (`@valancex/platform*`), no universal platform interface, no capability registry, and no browser-specific NEXUS API. Nothing in the evidence needs them.
- **Don't wrap `mesh-runtime`'s `init` in NEXUS.**
- **PORT's "no browser globals" rule,** and its server entry's DOM-free module graph.

---

## 18. Minimal platform boundary implied by current evidence

**FACT.** A platform supplies three things today, and all of them go only to the NEXUS application:
- capability resolutions, through `Environment`;
- Effect default services, through FiberRef layers;
- scoped resources.

Several environment operations the composed application performs go through no platform:
- the MESH engine's loading;
- DOM access;
- the container;
- HTML output;
- rendering's runtime.

**INTERPRETATION.**
- **The smallest real Platform boundary is the existing `Application.Platform` Layer.** It supplies:
  1. the capability resolutions the application's units declare. Today that is none in any composition;
  2. Effect's default services for the application runtime, **isolated** to that runtime. Today they aren't: P1.
- **A minimal browser platform** needs no capability for today's slice. It is the empty Environment, plus whatever default services the host wants to fix.
- **Precondition, not platform: the engine.** MESH's engine initialization is required in a browser, and the composer does it.
- **Precondition, not platform: the container.** The composer gives it to PORT.
- **The rest.** PORT's DOM and HTML are PORT's. Serving HTML and storage are unknown until some code needs them.
- **No new package boundary is required.**

---

## 19. Candidate next implementation milestone

**Release/component:** NEXUS v0.9.0, "Platform isolation, proven in a browser-hosted composition". The NEXUS change is in `src/`. The evidence harness lives in PORT's private `integration/` workspace, because that is the only place all three packages meet. No new package is created.

**Objective:** make the one existing platform seam correct (P1), and produce the missing evidence 1–5 (§15) with the existing slice. That way, v0.9's integration-readiness claim rests on a real browser, a real platform and a real capability.

**Scope:**
1. **NEXUS.** `Application.start` (through `Runtime.make`) must build the application's Layer so that FiberRef changes made by the platform's or the application's layers don't reach the calling fiber. They must also not persist after the application stops. D39 precedence must still hold *inside* the application. How to do it (for example, building in a child fiber whose FiberRefs aren't joined back) is decided in a v0.9 outline, not here.
2. **NEXUS docs.**
   - State the isolation guarantee in `application.md` and `runtime.md`.
   - Record, as current behavior with no change, that `Mesh.Host.render` and `renders` aren't admitted work and run where the caller runs them (P3).
3. **PORT `integration/` (test-only evidence).** Run the existing slice in real Chromium (the pre-installed Playwright browser). This includes:
   - the composer calling `mesh-runtime`'s `init` with the served `mesh-runtime.wasm`;
   - `Application.start` with a **test-local** platform that provides one capability, which the `users.refresh` command requires (for example, a users source backed by an in-page fixture);
   - that command's requirement written as a v0.8 admitted-unit declaration, analyzed with `Semantic.analyze` against the platform's provision statement;
   - the platform checked with the same conformance rule NEXUS's `tests/platform/conformance.ts` uses.

**Non-goals:**
- no `@valancex/platform*` package;
- no browser-specific NEXUS API;
- no composer package or public composer API;
- no change to MESH or render-v1;
- no change to PORT's public API;
- no SSR, routing, storage or network *implementation*;
- no capability metadata on primitives;
- no decision on whether rendering becomes admitted work;
- no fixes to documentation in other repositories beyond P4 and P5 notes (they are separate, docs-only changes).

**Required changes:**
- NEXUS: `src/runtime/index.ts` (and, if needed, `src/application/index.ts`), new tests, the doc updates above, and the release notes.
- PORT: in `integration/`, a browser test entry (for example, a Playwright-driven page that loads the slice as a bundle, or vitest's browser mode using `executablePath: /opt/pw-browsers/chromium`), a test-local platform, and a devDependency bump to `@valancex/nexus ^0.9.0` once it is published.

**Tests:**
- NEXUS regression tests from X2–X4:
  - the caller's Clock is unchanged while the application runs and after it stops;
  - a second application with no platform sees the caller's Clock, not the first platform's;
  - `referencePlatform({ clock })` behaves the same whether it is merged or provide-merged;
  - the existing D39 precedence tests pass unchanged.
- PORT browser slice:
  - the HTML after the draw equals `expectedFirstHtml`;
  - a real click on the avatar dispatches MESH's reviewed intent;
  - a real click on Refresh invokes `users.refresh`, which obtains its data through the platform capability, and updates the same `<img>` in place;
  - the capability's static verdict is `supported` against the platform's statement, and conformance reports no failures;
  - removing the capability from the platform makes the verdict `incompatible` and the command fail with `CapabilityUnavailableError`, while start still succeeds, because the capability isn't necessary to the start unit.

**Exit criteria:**
- The NEXUS suite passes, with the new isolation tests. The published NEXUS 0.9.0 has no public API change beyond documented behavior.
- The PORT integration passes in both Node/jsdom and Chromium against the published NEXUS 0.9.0, with one copy of `effect` and of `mesh-runtime`.
- A short evidence note records what the browser run proved, and re-states §14's table with the new rows.
- None of §17's items changed.

---

## 20. Open questions

**OPEN QUESTION.**
- **Q1. Where should the composer live once more than one application needs it?** Candidates are application code, tooling, or a package. Nothing in today's evidence decides this. It needs a second, differently shaped consumer, for example with two hosts or with routing.
- **Q2. Should `Mesh.Host.render`/`renders` be admitted work on the application runtime?** That would give rendering the platform's default services, refuse it after shutdown, and make it describable as a v0.8 unit. The case for it depends on whether any render ever needs a capability or a default service. No evidence shows that it does.
- **Q3. Should anything couple the PORT's lifetime to the application's?** For example: a composer that stops on `Stopping`, or reports refused after shutdown that are dropped rather than rejected. Today the tests order it by hand.
- **Q4. Can a platform supply default services in a way the provision statement can express and conformance can check?** Or do default services stay outside the capability model on purpose? The current evidence supports keeping them outside, but nothing has needed to state them yet.
- **Q5. What does SSR state transfer belong to** once a real server exists? Today it is test code (`JSON.stringify`). There's no evidence yet.
- **Q6. Duplicate package copies.** Both NEXUS's WeakMap registries and MESH's `Render` brand assume one module instance per realm. Does a bundled browser build, in the milestone above, keep one copy? This should be checked as part of the browser run.

---

## Appendix A. Dependency cleanup performed with this audit (PORT)

**FACT.** It is committed separately in ValanceX/Port on branch `claude/valance-integration-audit-4adgr2`:
- `package.json`: removed `pnpm.overrides` (`"@valancex/nexus>@valancex/mesh-runtime": "^0.6.0"`);
- `integration/package.json`: `@valancex/nexus` changed from `^0.8.0` to `^0.8.1`;
- `pnpm-lock.yaml`: regenerated. The `overrides:` block is gone, and `@valancex/nexus@0.8.0` became `0.8.1`. No other package changed;
- `integration/README.md` and `CHANGELOG.md` (`[Unreleased]`): updated to match. The released v0.2 notes are left as they were published.

Verification: `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test` pass (port-web 242, integration 15), and `pnpm why @valancex/mesh-runtime -r` finds one version, 0.6.0. `@valancex/port-web` is unchanged.

## Appendix B. Experiments

Each experiment was a temporary vitest file, deleted after it ran.
- **X1** (PORT `integration/test`): start an application, create state, build the slice host, render, then `Application.shutdown`. After that, `host.render` succeeds, and `Runtime.run(running.runtime, host.dispatch(r1, handler, payload))` rejects with `NEXUS: the runtime has begun terminating`.
- **X2** (PORT `integration/test`, NEXUS 0.8.0 from npm; the runtime source is identical in 0.8.1): the platform is `Layer.merge(EnvironmentLive(new Map()), Layer.setClock(c42))`. The results were: before start, false; in the application, true; in the caller's fiber, true; in a forked child, true; in a separate `Effect.runPromise`, false; after shutdown, true; after the scope closes, true.
- **X3** (NEXUS `tests/`, against `src/`): the platform-merge scenario gives `{caller: true, afterShutdown: true, afterScope: true}`. With the Clock in the application layer instead, it gives `{caller: true, afterShutdown: false, afterScope: false}`. The pure-Effect controls were: `Layer.merge` then `Scope.close` gives `afterClose: true`; `Layer.provideMerge` then `Scope.close` gives `afterClose: false`.
- **X4** (NEXUS `tests/`): application A on `referencePlatform({ clock: fixed(42) })` is started and shut down, and its scope closed. Application B is then started with no platform from the same fiber. `Runtime.run(B.runtime, Clock.currentTimeMillis)` returns `42`.
