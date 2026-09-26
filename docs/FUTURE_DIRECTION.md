# NEXUS — Future Direction

> NEXUS should let developers describe application intent in ordinary TypeScript and the existing JavaScript ecosystem, then analyze, optimize, validate, and execute that intent through a target-specific runtime.

This document describes the long-term direction of NEXUS.

It is **not an implementation plan** and does not require the current release to implement these capabilities. Its purpose is to prevent future development from accidentally constraining the architecture in ways that make the larger NEXUS vision impossible.

---

## 1. The Vision

NEXUS should become an execution and intent layer for TypeScript applications.

A developer should be able to use:

* TypeScript
* existing JavaScript and TypeScript libraries
* NEXUS primitives
* NEXUS-aware libraries
* platform-independent application APIs

without having to write every operation in a special NEXUS language.

The developer describes **what the application intends to do**.

NEXUS determines:

* what it understands;
* what it can optimize;
* what it must treat as opaque;
* what the selected target can execute;
* and how the resulting work should be executed.

The goal is not to replace the JavaScript ecosystem.

The goal is to give that ecosystem a stronger semantic and execution layer.

---

## 2. TypeScript Is the Developer Surface

NEXUS should remain approachable to ordinary TypeScript developers.

NEXUS should not require developers to rewrite normal application logic into a separate language merely to gain access to the runtime.

Existing libraries should remain usable.

For example:

```ts
import { z } from "zod";
import { parse } from "date-fns";

const result = nexus.run(() => {
  const user = z.parse(schema, input);

  return parse(user.date, format);
});
```

NEXUS does not need to understand every operation in this program.

It must instead classify operations according to what it knows about them.

The ecosystem should therefore degrade gracefully:

```text
NEXUS-understood
      ↓
optimizable / analyzable

NEXUS-described external library
      ↓
optimizable according to its declared contract

ordinary external JavaScript
      ↓
executable but opaque

target-incompatible dependency
      ↓
diagnostic error
```

---

## 3. NEXUS Must Never Depend on Reverse-Engineering Executed JavaScript

NEXUS should not compile arbitrary TypeScript to executable JavaScript, execute it, and then attempt to reconstruct an execution plan from the resulting behavior.

Execution is not a reliable representation of intent.

Arbitrary JavaScript can contain:

* side effects;
* dynamic dispatch;
* nondeterminism;
* environment access;
* mutation;
* asynchronous behavior;
* infinite loops;
* exceptions;
* I/O;
* runtime-generated code.

NEXUS therefore needs access to the describable structure of work **before that work executes**.

The fundamental direction is:

```text
TypeScript / libraries
        ↓
NEXUS capture / analysis
        ↓
NEXUS IR
        ↓
optimization
        ↓
target validation
        ↓
execution plan
        ↓
Port / runtime
```

Optimization is performed on representation, not reconstructed from completed execution.

---

## 4. The NEXUS Intermediate Representation

Future NEXUS should be capable of representing application work independently of its eventual execution.

The IR should represent at least:

* operations;
* dependencies;
* inputs and outputs;
* resource requirements;
* effects;
* determinism;
* cacheability;
* fusibility;
* target requirements;
* source locations.

The IR should be a semantic representation, not merely an instruction trace.

It should allow NEXUS to reason about relationships such as:

```text
A → B → C
```

rather than requiring the runtime to immediately execute:

```text
execute A
execute B
execute C
```

This distinction is fundamental.

### Core invariant

> **An operation that NEXUS intends to optimize must be representable before it executes.**

---

## 5. Opaque Operations Are Valid

NEXUS must not require complete semantic knowledge of every JavaScript function.

An external operation may be represented as an opaque boundary:

```text
Input
  │
  ▼
[Opaque JavaScript operation]
  │
  ▼
[NEXUS operation]
  │
  ▼
Output
```

An opaque operation may still execute normally.

However, NEXUS cannot safely assume properties that have not been established.

Unless explicitly described, NEXUS should not assume that an opaque operation is:

* pure;
* deterministic;
* cacheable;
* fusible;
* reorderable;
* parallelizable;
* portable.

Opaque operations therefore form optimization boundaries.

This is a **warning condition**, not automatically an error.

---

## 6. Libraries Can Become NEXUS-Aware

NEXUS should provide a way for libraries to describe their semantics to the NEXUS analyzer.

A library should not need to abandon its normal JavaScript API.

Conceptually:

```text
Library
 ├── normal JavaScript API
 └── NEXUS semantic description
```

A NEXUS description may expose properties such as:

```text
operation
effects
determinism
cacheability
fusibility
resource requirements
target requirements
```

This allows the ecosystem to progressively become NEXUS-aware.

A library can therefore move from:

```text
ordinary JavaScript
```

to:

```text
NEXUS-described JavaScript
```

without requiring a complete rewrite.

NEXUS should encourage adapters and semantic descriptors rather than attempting to recreate the entire npm ecosystem.

---

## 7. Optimization Is a Separate Semantic Layer

NEXUS optimization must preserve observable semantics.

The optimizer may eventually perform transformations such as:

* constant folding;
* dead-operation elimination;
* common-subexpression elimination;
* caching;
* operation fusion;
* batching;
* parallelization;
* dependency scheduling;
* resource reuse;
* target-specific lowering.

For example:

```text
map(filter(data, predicate), transform)
```

may be represented initially as:

```text
Filter
  ↓
Map
```

and optimized into:

```text
FusedIteration
```

allowing one traversal instead of two.

The optimizer must never assume that a transformation is valid merely because it appears faster.

Semantic contracts and effect information must establish that the transformation preserves observable behavior.

---

## 8. Compatibility Is Not Binary

NEXUS should distinguish at least three states:

### Supported

NEXUS understands the operation and the target can execute it.

```text
✓ supported
```

### Opaque

The operation can execute, but NEXUS cannot reason about some of its properties.

```text
⚠ opaque
```

### Incompatible

NEXUS can establish that the selected target cannot execute the required operation or capability.

```text
✗ incompatible
```

These states must not be conflated.

For example:

```text
zod.parse
  runtime: compatible
  optimization: opaque
```

is valid.

Whereas:

```text
node:fs
  target: browser
  runtime: incompatible
```

is an error.

---

## 9. Target Capabilities

The selected execution environment must expose a capability profile.

Conceptually:

```text
Browser
  ├── fetch
  ├── WebCrypto
  ├── IndexedDB
  └── Web Workers

Node
  ├── filesystem
  ├── processes
  ├── network
  └── workers
```

NEXUS should use these capabilities to determine whether a plan can execute on a target.

The application should not need to contain platform checks throughout feature code.

Instead:

```text
NEXUS semantic requirements
          ↓
target capability profile
          ↓
compatibility analysis
```

This preserves the existing NEXUS principle that platform capabilities should be resolved at explicit boundaries rather than scattered throughout application logic.

---

## 10. Diagnostics Are a First-Class NEXUS Contract

NEXUS diagnostics should be designed with the quality expected from a serious compiler.

Every diagnostic should have:

* severity;
* stable diagnostic code;
* message;
* primary source span;
* optional related spans;
* optional notes;
* optional suggestions.

Conceptually:

```ts
interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  primarySpan: Span;
  relatedSpans?: RelatedSpan[];
  notes?: string[];
  suggestions?: Suggestion[];
}
```

Diagnostics must retain source locations through analysis and optimization.

The editor should be able to highlight the exact identifier, call, import, or expression responsible for the diagnostic.

---

## 11. Diagnostics Should Explain, Not Merely Reject

An opaque operation should produce a warning such as:

```text
⚠ N2001: opaque operation

`externalLibrary.process` has no NEXUS semantic description.

NEXUS cannot establish:
- purity
- determinism
- cacheability
- portability

The operation will execute through the JavaScript runtime
and acts as an optimization boundary.
```

An incompatible operation should produce an error such as:

```text
✗ N1004: incompatible target

`node:fs` requires the `filesystem` capability.

The selected Browser target does not provide this capability.
```

Where possible, diagnostics should explain **why** the condition exists and how the developer can resolve it.

---

## 12. Diagnostics Must Work Everywhere

The same diagnostic model should serve:

```text
NEXUS analyzer
      │
      ├── CLI
      ├── development server
      ├── build
      └── language server / editor
```

The development server should therefore not invent its own diagnostic system.

Likewise, an editor should not need to understand NEXUS internals.

NEXUS produces structured diagnostics; tooling renders them.

Long-term, diagnostics should be suitable for LSP integration so developers can see:

* inline errors;
* warnings;
* hover information;
* related locations;
* code actions;
* source navigation.

---

## 13. Development and Production Must Share Semantics

The development server, build system, and production runtime must not become three independent implementations of NEXUS semantics.

They should operate on the same conceptual pipeline:

```text
                  TypeScript
                      │
                      ▼
               NEXUS analysis
                      │
                      ▼
                  NEXUS IR
                      │
              ┌───────┴───────┐
              ▼               ▼
          diagnostics      optimizer
              │               │
              └───────┬───────┘
                      ▼
                execution plan
                      │
                      ▼
                    Port
```

The development server may perform this incrementally.

The production build may perform it ahead of time.

The runtime may perform additional specialization when necessary.

But the semantic model must remain shared.

---

## 14. Incremental Development Is a First-Class Goal

The development server should eventually maintain an incremental NEXUS representation.

When a developer changes:

```text
foo.ts
```

NEXUS should invalidate only the affected portion of the semantic graph where possible.

Conceptually:

```text
source change
    ↓
affected IR
    ↓
re-analysis
    ↓
affected optimization
    ↓
diagnostics update
    ↓
development execution update
```

This should support a development experience where compatibility and optimization feedback appears continuously while the developer works.

---

## 15. Port Is the Physical Execution Boundary

NEXUS should describe semantic execution.

PORT should provide the physical mechanisms required by a target environment.

Conceptually:

```text
NEXUS
  semantic intent
       ↓
  semantic IR
       ↓
  optimized execution plan
       ↓
PORT
  target-specific implementation
```

NEXUS should not become a collection of platform-specific APIs.

Likewise, PORT should not redefine NEXUS semantics.

A target may expose capabilities such as:

* filesystem;
* networking;
* GPU;
* workers;
* native windows;
* storage;
* sensors;
* device APIs.

NEXUS determines what the application requires.

PORT determines how those capabilities are physically provided.

---

## 16. The Current Runtime Remains Important

The current NEXUS runtime primitives are not obsolete because of this future direction.

Application, Runtime, Service, State, Selector, Command, Capability, Resource, and Event establish the semantic foundation on which the future execution model can be built.

The future optimizer must respect their existing lifecycle and ownership guarantees.

In particular:

* resources must retain deterministic ownership;
* shutdown semantics must remain explicit;
* state ownership must remain explicit;
* events must remain typed;
* capabilities must remain explicit;
* commands must retain their observable behavior;
* runtime failures must remain part of the defined semantic model.

Optimization must never weaken lifecycle correctness.

---

## 17. What NEXUS Must Not Become

NEXUS should not become:

### A replacement for JavaScript

Existing JavaScript and TypeScript libraries are an asset.

### A second programming language unnecessarily

The primary developer surface should remain approachable TypeScript.

### A JavaScript decompiler

NEXUS should not execute arbitrary JavaScript and attempt to infer its semantic intent afterward.

### A universal platform abstraction

NEXUS owns semantic requirements.

PORT owns physical platform mechanisms.

### An optimizer that requires everything to be understood

Opaque execution must remain possible.

### A compiler that rejects uncertainty by default

Unknown semantics should normally produce a warning and an optimization boundary.

Proven incompatibility should produce an error.

---

## 18. Architectural Invariants for Future Work

Future NEXUS changes should preserve these invariants unless this document is deliberately revised.

### I1 — Intent precedes execution

NEXUS must be capable of representing describable work before executing it.

### I2 — Opaque JavaScript remains usable

A lack of NEXUS knowledge must not automatically make ordinary JavaScript unusable.

### I3 — Unknown semantics are explicit

NEXUS must not silently assume properties it cannot establish.

### I4 — Optimization preserves semantics

An optimized plan must have the same observable behavior as the corresponding unoptimized plan.

### I5 — Incompatibility is target-specific

An operation may be valid for one target and invalid for another.

### I6 — Diagnostics preserve source locations

Analysis must retain enough source information to report precise diagnostics.

### I7 — Tooling consumes shared diagnostics

CLI, development server, build system, and editor integrations must consume the same diagnostic model.

### I8 — Port owns physical execution

Platform-specific mechanisms belong behind the PORT boundary.

### I9 — Lifecycle guarantees survive optimization

Optimization must not violate NEXUS resource, state, event, or shutdown contracts.

### I10 — Optimization is optional for correctness

A program must remain semantically valid even when an optimization cannot be performed.

The following invariants were established by NEXUS v0.4 (the semantic analysis foundation; see `superpowers/specs/2026-09-26-nexus-v0.4-outline.md`). They refine the ones above, as noted, and hold for all later work unless this document is deliberately revised.

### I11 — Semantic facts precede execution (refines I1)

Every semantic fact, verdict, classification and diagnostic is established without executing the operation it concerns, and without running any application code. Semantic analysis needs no started application or runtime.

### I12 — Unknown semantics remain executable, and opaque is never incompatible (refines I2 and I10)

Missing information never produces an incompatible verdict or an error. Analysis never changes whether or how an operation executes. *Opaque* means NEXUS cannot establish a fact; it never means invalid, unsafe or failed.

### I13 — Diagnostics are representation-independent (refines I7)

A diagnostic is plain data that survives a JSON round trip unchanged, with no function, class instance, error object, markup or pre-rendered excerpt. Equal inputs give equal diagnostics in equal order, whoever consumes them.

### I14 — Declared semantics are the analysis boundary (refines I3)

A semantic property is known only when a declaration explicitly represents it. Nothing is inferred from executing code, erased types, names, conventions or source inspection, unless a later release introduces an explicit producer of declarations. A property that isn't known is never treated as false or empty.

### I15 — Target capability is distinct from application capability

Target capabilities and application capabilities are separate concepts, with separate identifier spaces. Semantic analysis neither reads nor affects how application capabilities resolve, and application capability configuration never decides a target capability.

### I16 — Target compatibility comes from declarations, not execution or discovery (refines I5)

A verdict depends only on declared requirements and an explicitly supplied target profile. Incompatibility is proven, never inferred: it needs a declared requirement and an explicit "not provided". A capability the profile doesn't mention is undecided.

### I17 — Source provenance is preserved (refines I6)

Every supplied provenance reaches every diagnostic about it exactly: never synthesized, approximated, widened or moved. A diagnostic whose subject has no supplied location says so explicitly.

### I18 — Semantic analysis does not expose Effect internals

The semantic model's public types reference no Effect or NEXUS runtime type, and its entry point is not an Effect.

### I19 — Lifecycle and ownership guarantees are unchanged by analysis

Semantic analysis observes, alters and depends on no lifecycle state, and changes no error channel, admission rule or ownership rule.

---

## 19. Long-Term Shape

The intended evolution of NEXUS is therefore:

```text
Current
────────────────────────────────────────────

Application primitives
Runtime
Resources
Capabilities
State
Commands
Events
Services
Selectors


Future
────────────────────────────────────────────

TypeScript + JS ecosystem
          │
          ▼
   NEXUS semantic capture
          │
          ▼
     NEXUS diagnostics
          │
          ▼
        NEXUS IR
          │
          ▼
       optimizer
          │
          ▼
   target compatibility
          │
          ▼
   optimized execution plan
          │
          ▼
         PORT
          │
          ▼
    physical execution
```

The existing runtime is therefore the foundation, not the final form.

The long-term purpose of NEXUS is to make **application intent observable to the execution system without forcing developers to abandon TypeScript or the JavaScript ecosystem**.

That is the direction future architecture should preserve.
