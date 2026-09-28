# NEXUS Roadmap

**Scope:** NEXUS v0.5 → v1.0
**Status:** Directional roadmap / architectural keepsake
**Package:** `@valancex/nexus`

---

## 1. Purpose

This document defines the intended development direction for NEXUS from v0.5 through v1.0.

The previous roadmap treated platform concerns as something that could be addressed during VALANCE integration. That is too late.

NEXUS currently has only a partial distinction between:

* application behavior;
* runtime infrastructure;
* platform capabilities;
* Effect infrastructure;
* integration concerns.

That distinction must be established before NEXUS can claim a mature application semantic model.

The revised roadmap therefore follows:

```text
semantic foundation
        ↓
runtime/platform separation
        ↓
platform capabilities
        ↓
application semantics
        ↓
VALANCE integration
        ↓
real-world hardening
        ↓
stable NEXUS
```

The objective of v1.0 is not to make NEXUS a universal runtime.

The objective is to establish a stable, platform-independent application runtime and semantic contract that can be hosted by different environments and integrated with the other VALANCE packages.

---

# 2. Architectural Position

NEXUS is the application behavior and coordination layer of VALANCE.

It is built heavily on Effect.

The intended relationship is:

```text
Effect
  ↓
NEXUS runtime
  ↓
NEXUS application semantics
  ↓
platform capabilities
```

Effect provides the compositional runtime mechanism.

NEXUS defines what application behavior means.

Platform packages provide environment-specific capabilities.

MESH defines template and rendering semantics.

PORT realizes those semantics against concrete targets.

Tooling orchestrates development, building, and deployment.

---

# 3. The Core Architectural Distinction

The architecture should distinguish four different concerns.

## 3.1 Effect

Effect is the underlying mechanism.

It provides concepts such as:

* `Effect`;
* `Context`;
* `Layer`;
* resources;
* concurrency;
* scheduling;
* streams;
* error handling;
* dependency composition.

NEXUS should use these mechanisms extensively.

However, NEXUS should not merely expose raw Effect services as its architecture.

---

## 3.2 NEXUS

NEXUS owns application-level semantics.

This includes:

* application lifecycle;
* application state;
* selectors;
* commands;
* application resources;
* application behavior;
* application-level capabilities;
* semantic analysis;
* application semantic facts.

NEXUS should not need to know whether it is executing in:

* a browser;
* a server;
* a worker;
* a test environment;
* a native environment;
* another future platform.

---

## 3.3 Platform

A platform provides capabilities supplied by the environment in which the application executes.

Examples may include:

* clocks;
* networking;
* storage;
* filesystem;
* process/environment access;
* browser APIs;
* server APIs;
* worker APIs;
* native APIs.

The platform owns knowledge of the environment.

NEXUS should consume platform capabilities through explicit contracts rather than embedding environment-specific assumptions.

---

## 3.4 Tooling

Tooling orchestrates the packages.

It may eventually provide:

* CLI;
* build;
* watch mode;
* dev server;
* HMR;
* SSR orchestration;
* prerendering;
* debugging;
* deployment workflows.

Tooling should not become another semantic owner.

---

# 4. Effect as the Foundation

The intended relationship is:

```text
NEXUS semantic capability
        ↓
Effect service / Context
        ↓
platform Layer
```

For example:

```text
Application requires:
    Clock
    Network
    Storage
```

A platform supplies:

```text
Browser:
    Clock
    Network
    Storage

Worker:
    Clock
    Network

Server:
    Clock
    Network
    Filesystem
```

Effect provides the mechanism by which those implementations are composed into the running application.

This gives NEXUS a platform-independent dependency model without requiring NEXUS itself to understand the implementation environment.

---

# 5. Important Boundary: NEXUS Is Not Effect

NEXUS should not simply turn every platform facility into a raw Effect service and call that the architecture.

For example, an application should generally depend on a domain-level concept such as:

```text
AssetStore
```

rather than directly depending on:

```text
NodeFileSystem
```

The desired relationship is:

```text
NEXUS domain concept
        ↓
Effect service
        ↓
platform implementation
```

rather than:

```text
NEXUS
  ↓
Node-specific Effect service
```

This preserves the distinction between:

* application semantics;
* runtime mechanism;
* environment implementation.

---

# 6. v0.5 — Semantic Foundation

**Status:** Released

## Objective

Establish semantic analysis as a strict, independent leaf of NEXUS.

v0.5 establishes the machinery required for NEXUS to represent validated semantic information without turning semantic analysis into a compiler, runtime planner, or platform layer.

## Established capabilities

* semantic declarations;
* semantic contexts;
* semantic analysis;
* validated plain-data semantic output;
* structured diagnostics;
* provenance;
* supported / opaque / incompatible classifications;
* closed and open relationship sets;
* explicit values and data flow;
* compatibility with previous contracts;
* MESH host integration boundary.

## Architectural invariants

### Semantic analysis remains a leaf

The semantic layer must not depend on:

* NEXUS runtime primitives;
* application lifecycle;
* MESH;
* PORT;
* renderer implementation;
* platform discovery.

### Opaque remains distinct from incompatible

`opaque` means:

> NEXUS cannot establish the fact.

It does not mean:

* invalid;
* unsafe;
* unsupported;
* incompatible;
* failed.

### Diagnostics remain descriptive

NEXUS reports facts and classifications.

Consumers decide what those facts mean operationally.

## What v0.5 does not establish

v0.5 does not yet establish:

* a complete platform model;
* application capability requirements;
* a final platform package structure;
* SSR;
* HMR;
* browser runtime semantics;
* native runtime semantics.

Those belong to later work.

---

# 7. v0.6 — Runtime & Platform Boundary

## Objective

Determine what actually belongs to NEXUS and what must be supplied by an execution environment.

This is the most important architectural step after v0.5.

The central question is:

> What is NEXUS, and what is the platform?

## 7.1 Audit the existing runtime

Every existing NEXUS primitive and runtime dependency should be classified as one of:

```text
NEXUS-owned
Effect infrastructure
platform-owned
integration concern
```

The classification must come from the actual implementation.

Do not design an imaginary platform abstraction first.

## 7.2 Identify environmental assumptions

Find assumptions such as:

* time;
* networking;
* filesystem;
* storage;
* process state;
* environment variables;
* browser APIs;
* server APIs;
* external resources;
* scheduling;
* platform-specific lifecycle behavior.

Determine whether each assumption is genuinely application semantics or environmental infrastructure.

## 7.3 Establish the first platform boundary

Platform-specific behavior should move behind explicit service boundaries where justified.

Conceptually:

```text
NEXUS application
       ↓
NEXUS capability
       ↓
Effect Context
       ↓
Platform Layer
```

The exact API and package decomposition should emerge from the audit.

## 7.4 Avoid premature package proliferation

Do not immediately create a large family such as:

```text
@valancex/platform-core
@valancex/platform-web
@valancex/platform-node
@valancex/platform-worker
@valancex/platform-native
...
```

unless the actual implementation demonstrates that these boundaries are useful.

The first platform package should be derived from evidence.

## Exit condition

A NEXUS application can be reasoned about independently of the environment in which it will eventually execute.

NEXUS no longer needs embedded knowledge of a specific platform to implement application behavior.

---

# 8. v0.7 — Platform Capability Model

Once the runtime/platform boundary exists, establish how applications express environmental requirements.

The central question becomes:

> How does an application declare what it requires from its environment?

## Conceptual model

```text
Application
    │
    │ requires
    ▼
NEXUS capability contract
    │
    │ provided by
    ▼
Platform
    │
    │ implemented through
    ▼
Effect Layer
```

For example:

```text
Application requires:
    Network
    Storage
    Clock
```

A platform provides:

```text
Browser:
    Network
    Storage
    Clock
```

NEXUS can then reason about the relationship.

```text
required capability
        ×
provided capability
        ↓
supported / opaque / incompatible
```

## Important restriction

Do not create a universal capability encyclopedia.

Capabilities should emerge from actual NEXUS requirements.

If an application does not need a capability, NEXUS does not need to invent a semantic abstraction for it.

## Relationship to existing semantic work

The semantic classifications established in v0.4/v0.5 become useful here:

```text
supported
opaque
incompatible
```

For example:

```text
Application requires:
    Filesystem

Platform:
    Browser

Result:
    incompatible
```

or, when NEXUS cannot establish enough information:

```text
Application requires:
    X

Platform information:
    incomplete

Result:
    opaque
```

## Exit condition

NEXUS can describe the environmental capabilities required by an application without embedding a specific environment into the application runtime.

---

# 9. v0.8 — Application Semantics

Status: Released (v0.8.0, 2026-09-27)

Only after the runtime/platform distinction is established should application semantics become a major focus.

The central question is:

> What facts can NEXUS reliably expose about an application?

NEXUS may expose facts about:

* state;
* selectors;
* commands;
* resources;
* relationships;
* dependencies;
* application capabilities;
* required platform capabilities;
* provenance;
* behavior.

For example:

```text
Application
 ├── Selector<User>
 ├── Command<SelectUser>
 ├── Resource<UserRepository>
 │       └── requires Network
 └── requires Storage
```

The semantic model now has a clear separation between:

```text
application semantics
```

and:

```text
platform semantics
```

and:

```text
Effect implementation
```

## Important boundary

NEXUS describes its own domain.

It should not become a general analyzer of every external system.

9.1 As decided and implemented (2026-09-27)

Status: released (v0.8.0; docs/releases/v0.8.md).

The v0.8 outline (Revision 2) decides, with no public API change and no
src/ change:

Units      A requirement is owned by a unit: the start unit (the service
           graph build) or an admitted unit (an effect run through the
           runtime, typically a command). One standalone declaration per
           unit. No primitive value carries a requirement. (D57, D58, I39)
Contexts   An application context describes one composition against one
           platform statement. It contains the units its producer chose to
           describe, and is never implied to list them all. Declaration ids
           are local to the context. (C24, D65)
Necessity  Application necessity is the start unit's requirement. The union
           over described units is the requirement set, not necessity.
           (C27, I41)
Algebra    The requirement set and classification are a documented
           aggregation (C26), pinned by test tooling, not exported.
L2         Closed; D17 confirmed. (D64)

The tree above reads accordingly. "Resource<UserRepository> requires Network"
is the requirement of whichever unit uses the implementation composed behind
UserRepository, in that composition: the primitive carries nothing.
"Application requires Storage" is either the start unit's necessity, or a
member of the requirement set. These are two different facts.

---

# 10. v0.9 — VALANCE Integration Readiness

At this point the NEXUS runtime should be mature enough to define its integration boundaries with the other VALANCE packages.

The central question becomes:

> Can NEXUS, MESH, PORT, and a platform participate in a real system without weakening their ownership boundaries?

## NEXUS

Provides:

```text
application
state
selectors
commands
resources
semantic facts
capability requirements
platform boundary
```

## MESH

Provides:

```text
MPRX
template semantics
runtime evaluation
render-v1
events
command intents
```

## PORT

Provides:

```text
target lowering
target implementation
target-specific capabilities
```

## Platform

Provides:

```text
environment capabilities
Effect Layers
environment-specific resources
```

The packages should remain independently usable.

---

10.1 As decided and implemented (2026-09-28)

Status: implemented in 0.9.0, and prepared for release
(docs/releases/v0.9.md). Publication is pending the v0.9.0 tag.

The integration audit (docs/architecture/2026-09-28-valance-integration-audit.md)
found the first composed evidence the question above needed. It found one
defect at the platform boundary:
- **P1.** A platform's FiberRef layers reached the fiber that started the
  application.
- **J1.** Runtime.runFork handed that fiber the application's own fiber.

v0.9 establishes caller isolation (the v0.9 outline, I44–I49, C29–C32):
FiberRefs flow from the caller into the application, never back, across the
boundaries NEXUS creates. Those boundaries are start/make, termination,
run, and runFork's handle. There is no public API change.

A Chromium tracer bullet in PORT's private integration workspace composes a
real application end to end:
MPRX → the MESH compiler/runtime → NEXUS (state, commands, one capability)
→ a test platform → a composer → PORT Web → Chromium.

It needed no ownership change, no platform package and no browser-specific
NEXUS API. Two questions stay open:
- O15: rendering runs outside the application's lifecycle;
- O19: an application can deliberately return its execution state as a
  value.

---

# 11. Integration Landmark

The first serious VALANCE integration should contain **five conceptual pieces**:

```text
                    MESH
                     │
                  template
                     │
                     ▼
                  NEXUS
               application
               state/logic
                     │
                     ▼
                PLATFORM
               Effect Layers
                     │
                     ▼
                   PORT
              target lowering
                     │
                     ▼
                real target
```

This is deliberately different from the original three-package integration model.

The platform is now explicitly represented.

## First web experiment

A browser-oriented path might eventually resemble:

```text
MPRX
 ↓
MESH
 ↓
NEXUS application
 ↓
web platform
 ↓
PORT web target
 ↓
browser
```

A server-oriented path might resemble:

```text
MPRX
 ↓
MESH
 ↓
NEXUS application
 ↓
server platform
 ↓
PORT web-server target
 ↓
HTML response
```

These are integration experiments.

They are not special NEXUS modes.

---

# 12. SSR Is a Platform/Target Composition

SSR should not become:

```text
NEXUS.ssr()
```

SSR is better understood as a composition of:

```text
NEXUS
+
server platform
+
MESH runtime
+
web-server PORT
+
tooling/host orchestration
```

Conceptually:

```text
HTTP request
     │
     ▼
server platform
     │
     ▼
NEXUS application
     │
     ▼
MESH runtime
     │
     ▼
PORT web-server lowering
     │
     ▼
HTML response
```

The application remains application logic.

The server environment provides server capabilities.

PORT determines how the render representation becomes HTML.

Tooling/host coordinates the request.

This keeps SSR from becoming a web-specific concept inside NEXUS.

---

# 13. Other Rendering Modes

The same architecture should allow other rendering modes without creating special NEXUS features for each one.

Potential examples include:

```text
browser rendering
server rendering
prerendering
streaming rendering
email rendering
PDF rendering
terminal rendering
native rendering
preview rendering
testing rendering
```

The common structure is:

```text
application behavior
        ↓
application state / facts
        ↓
MESH render semantics
        ↓
PORT target realization
```

The environment is supplied separately through the platform.

This means the architecture does not need to predict every future rendering mode today.

---

# 14. v0.10 — Integrated Hardening

The first real integration should be treated as an architectural experiment.

v0.10 should capture what the experiment teaches.

Investigate:

* application state boundaries;
* platform service lifetimes;
* request scope;
* application scope;
* resource cleanup;
* serialization;
* hydration;
* render consistency;
* target capability mismatch;
* platform capability mismatch;
* diagnostics;
* command/event identity;
* replacement and reload behavior.

The purpose is to discover which abstractions have earned existence.

---

# 15. HMR

HMR should not be treated as a NEXUS feature.

It belongs primarily to tooling.

Conceptually:

```text
source change
    ↓
dev server
    ↓
MESH rebuild
    ↓
application replacement
    ↓
NEXUS lifecycle semantics
    ↓
platform resource reconciliation
    ↓
PORT target update
```

However, integration may reveal that NEXUS needs a general application replacement or reconciliation contract.

If so, that contract should be designed around application semantics rather than around the term `HMR`.

For example, NEXUS may eventually need to answer:

```text
What state survives replacement?
What resources are recreated?
What resources remain?
What must be disposed?
```

Those are NEXUS lifecycle questions.

The fact that HMR caused them is incidental.

---

# 16. Tooling Architecture

Tooling should remain outside NEXUS core.

Conceptually:

```text
                    VALANCE TOOLCHAIN
                           │
             ┌─────────────┼─────────────┐
             │             │             │
           Build        Dev Server      CLI
             │             │             │
             └─────────────┼─────────────┘
                           │
                    NEXUS / MESH / PORT
                           │
                        Platform
```

Tooling may orchestrate:

* compilation;
* file watching;
* module graphs;
* development servers;
* HMR;
* SSR;
* prerendering;
* asset serving;
* diagnostics;
* debugging;
* production builds.

Tooling should compose the package contracts rather than becoming a semantic layer that all packages depend on.

---

# 17. Capability Ownership

There are several kinds of capability and they must not be conflated.

## Application capability

Something the application itself can do or requires.

Owned semantically by NEXUS.

## Platform capability

Something the execution environment can provide.

Owned by the platform.

## Target capability

Something a rendering target can realize.

Owned by PORT/target integration.

For example:

```text
Application:
    requires Network

Platform:
    provides Network

PORT:
    requires DOM event support
```

These are different statements.

A platform having `DOM` does not automatically mean PORT can realize every DOM rendering behavior.

Likewise, a target supporting a feature does not mean the NEXUS application has access to the underlying platform capability.

---

# 18. Information Flow

VALANCE should prefer:

```text
producer
   ↓
explicit contract
   ↓
consumer
```

over:

```text
producer
   ↓
generic middleware
   ↓
arbitrary information transport
   ↓
consumer
```

Effect's service/context model can provide the mechanism for dependency composition.

It should not replace semantic ownership.

The meaning of information must be defined by the contract, not by the path through which the information happens to travel.

---

# 19. Preserve Information Until Its Boundary

A recurring architectural principle is:

> Do not discard information merely because the current layer does not need it.

Instead:

```text
rich representation
       ↓
explicit boundary
       ↓
consumer-specific interpretation
```

Examples:

* semantic facts retain provenance;
* diagnostics retain spans;
* render events retain handler identity;
* platform capabilities retain explicit identity;
* target lowering remains inspectable.

However, preservation does not justify creating a universal representation for everything.

Information should remain owned by the layer that gives it meaning.

---

# 20. What NEXUS Must Not Become

Throughout v0.5 → v1.0, the following remain explicit non-goals.

## Not a compiler

NEXUS must not become a TypeScript or MPRX compiler.

## Not a renderer

NEXUS does not render UI.

## Not PORT

Target lowering belongs to PORT.

## Not MESH

Template and render semantics belong to MESH.

## Not a platform

NEXUS should not contain browser/server/native implementations.

## Not a platform registry

NEXUS should not become a global encyclopedia of every environment's capabilities.

## Not a universal middleware bus

NEXUS should not expose arbitrary information merely because middleware can transport it.

## Not a web framework

SSR, hydration, browser APIs, HTTP servers, and HMR should not become intrinsic NEXUS concepts.

## Not a tooling framework

Dev servers, CLIs, build graphs, and deployment orchestration belong outside NEXUS core.

## Not an optimizer

Optimization should follow evidence from real execution and integration.

## Not an automatic discovery system

NEXUS should not infer the external environment unless an explicit platform contract provides the necessary information.

## Not a giant semantic graph

Relationships should be added because concrete consumers require them.

## Not an integration-driven monolith

The existence of MESH, PORT, and platform packages must not force NEXUS internals to absorb their concerns.

---

# 21. Revised Release Sequence

```text
v0.5
Semantic Foundation
    │
    │ Can NEXUS represent semantic facts?
    ▼
v0.6
Runtime / Platform Boundary
    │
    │ What belongs to NEXUS?
    │ What belongs to the environment?
    ▼
v0.7
Platform Capability Model
    │
    │ How does an application express environmental requirements?
    ▼
v0.8
Application Semantics
    │
    │ What facts can NEXUS expose about application behavior?
    ▼
v0.9
VALANCE Integration Readiness
    │
    │ Can the package boundaries work together?
    ▼
I1
First Real Platform + MESH + PORT
    │
    │ What does reality reveal?
    ▼
v0.10
Integrated Hardening
    │
    │ Which contracts actually survived?
    ▼
v1.0
Stable NEXUS
```

---

# 22. Release Discipline

Each release should answer four questions.

## 22.1 What new contract exists?

The release must establish an explicit capability.

## 22.2 What remains intentionally unresolved?

Deferred decisions must be named rather than silently guessed.

## 22.3 What evidence is required?

The release should identify tests, consumers, or integration scenarios that justify its new contract.

## 22.4 What must not change?

Existing package boundaries and invariants should remain intact unless the release explicitly revises them.

---

# 23. v1.0 Definition of Done

NEXUS is ready for v1.0 when:

* application lifecycle semantics are stable;
* commands and selectors have stable contracts;
* application state behavior is stable;
* resource semantics are stable;
* semantic analysis has a stable public model;
* semantic classifications are stable;
* diagnostics have stable structure and meaning;
* provenance is stable enough for supported consumers;
* application semantics can describe meaningful NEXUS behavior;
* application capability requirements have a stable representation;
* platform capability boundaries are explicit;
* NEXUS does not contain environment-specific runtime assumptions that belong in platform packages;
* platform implementations can provide NEXUS requirements through explicit contracts;
* NEXUS/MESH integration uses explicit contracts;
* NEXUS/PORT integration does not require NEXUS to own target concerns;
* capability relationships have been tested against a real platform;
* the first real VALANCE vertical slice has succeeded;
* integration failure semantics are explicit;
* no critical public contract depends on package internals;
* lessons from real integration have been incorporated into the public contracts.

---

# 24. Final Architectural Principle

The roadmap can be summarized as:

> **NEXUS should become platform-independent before it becomes integration-dependent.**

The intended architecture is:

```text
                         VALANCE
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
     NEXUS                 MESH                 PORT
       │                    │                    │
 application            template              target
 behavior               semantics            lowering
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                       Effect foundation
                            │
                    explicit platform
                         boundary
                            │
             ┌──────────────┼──────────────┐
             │              │              │
          Web Platform   Server         Future
                         Platform       Platforms
```

The fundamental dependency direction is:

```text
Effect
  ↓
NEXUS
  ↓
platform contracts
  ↓
platform implementations
```

while rendering follows:

```text
NEXUS application
        ↓
MESH
        ↓
PORT
        ↓
target
```

and tooling composes everything:

```text
Tooling
  ↓
NEXUS + MESH + PORT + Platform
```

The goal is not to predict every platform, rendering mode, or development workflow.

The goal is to make the boundaries strong enough that new platforms, targets, and tooling can be added **without redefining what NEXUS is**.

> **NEXUS owns application behavior.
> Effect provides the compositional mechanism.
> Platforms provide environmental capability.
> MESH provides rendering semantics.
> PORT realizes those semantics.
> Tooling composes the system for development and deployment.**
