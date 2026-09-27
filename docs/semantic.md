# Semantic

> **In plain terms:** You describe an operation in plain data — what it is, where it was declared, and which capabilities it can't work without. NEXUS checks that description against a profile you supply, which states what one provider provides, and tells you, before anything runs, whether the operation is **supported**, **opaque** (NEXUS can't tell) or **incompatible** (proven not to work with that provider). In v0.7 the provider is a *platform*, and the capabilities are application capabilities, named by their `id` (see Targets and bindings).

`Semantic` is not a primitive. It is the semantic analysis foundation added in v0.4 and given a validated IR in v0.5 (see [`ARCHITECTURE.md`](./ARCHITECTURE.md) §16.1, the [v0.4 outline](./superpowers/specs/2026-09-26-nexus-v0.4-outline.md) and the [v0.5 outline](./superpowers/specs/2026-09-26-nexus-v0.5-outline.md)). It is a leaf module: it imports nothing, nothing in NEXUS but the package entry imports it, and nothing it produces changes how anything executes.

## Responsibility

- Evaluate **explicitly declared** semantic facts about operations against an **explicitly supplied** target profile, without executing anything (outline §2).
- Produce a structured result per operation — a verdict with its cause, and a classification — and, where the rules require one, a diagnostic.
- Reject malformed input as a *rejection*, never as a diagnostic.

It does not read source, inspect functions, discover targets, or gate execution.

## Data Model

A declaration is a claim by its author. NEXUS doesn't verify it; every verdict is relative to what was declared.

```ts
interface Span {
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

interface Requirement {
  readonly capability: string;
  readonly provenance?: Span;
}

interface TargetRequirements {
  readonly completeness: "complete" | "partial";
  readonly capabilities: ReadonlyArray<Requirement>;
}

interface ValueDeclaration {
  readonly id: string;
  readonly name?: string;
  readonly provenance?: Span;
}

interface ValueReference {
  readonly value: string;
  readonly provenance?: Span;
}

interface DataFlow {
  readonly completeness: "complete" | "partial";
  readonly references: ReadonlyArray<ValueReference>;
}

interface Declaration {
  readonly id: string;
  readonly name?: string;
  readonly provenance?: Span;
  readonly requirements?: TargetRequirements;
  readonly inputs?: DataFlow;
  readonly outputs?: DataFlow;
}

interface TargetProfile {
  readonly name: string;
  readonly provenance?: Span;
  readonly provided: ReadonlyArray<string>;
  readonly notProvided: ReadonlyArray<string>;
}

type Property = "target-requirements";

type RequiredFact = "target-compatibility";

interface AnalysisContext {
  readonly values?: ReadonlyArray<ValueDeclaration>;
  readonly declarations: ReadonlyArray<Declaration>;
  readonly profile: TargetProfile;
  readonly require?: ReadonlyArray<RequiredFact>;
}

type Verdict =
  | { readonly _tag: "Compatible" }
  | { readonly _tag: "Incompatible"; readonly notProvided: ReadonlyArray<string> }
  | { readonly _tag: "Undetermined"; readonly cause: "operation"; readonly requirements: "undeclared" | "partial" }
  | { readonly _tag: "Undetermined"; readonly cause: "target"; readonly undecided: ReadonlyArray<string> };

type Classification = "supported" | "opaque" | "incompatible";

interface OperationResult {
  readonly id: string;
  readonly known: ReadonlyArray<Property>;
  readonly verdict: Verdict;
  readonly classification: Classification;
}

type DiagnosticCode =
  | "nexus-incompatible-target-capability"
  | "nexus-opaque-operation"
  | "nexus-undetermined-target-capability";

type Severity = "warning" | "error";

type Location =
  | { readonly _tag: "Span"; readonly span: Span }
  | { readonly _tag: "Unlocated" };

interface RelatedSpan {
  readonly span: Span;
  readonly label: string;
}

interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly message: string;
  readonly location: Location;
  readonly subject: string;
  readonly related: ReadonlyArray<RelatedSpan>;
  readonly notes: ReadonlyArray<string>;
}

type RejectionReason =
  | "duplicate-identity"
  | "missing-identity"
  | "invalid-span"
  | "empty-capability"
  | "conflicting-decision"
  | "unresolved-reference";

interface RejectionIssue {
  readonly reason: RejectionReason;
  readonly path: ReadonlyArray<string | number>;
}

type AnalysisOutcome =
  | {
      readonly _tag: "Analyzed";
      readonly properties: ReadonlyArray<Property>;
      readonly required: ReadonlyArray<RequiredFact>;
      readonly profile: string;
      readonly operations: ReadonlyArray<OperationResult>;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    }
  | { readonly _tag: "Rejected"; readonly issues: ReadonlyArray<RejectionIssue> };
```

`Semantic.build` returns the semantic IR: every declared fact, validated, as plain data with no optional fields.

```ts
type Name =
  | { readonly _tag: "Named"; readonly name: string }
  | { readonly _tag: "Unnamed" };

interface BuiltRequirement {
  readonly capability: string;
  readonly provenance: Location;
}

type BuiltRequirements =
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Declared"; readonly completeness: "complete" | "partial"; readonly capabilities: ReadonlyArray<BuiltRequirement> };

interface BuiltReference {
  readonly value: string;
  readonly provenance: Location;
}

type BuiltFlow =
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Declared"; readonly completeness: "complete" | "partial"; readonly values: ReadonlyArray<string>; readonly references: ReadonlyArray<BuiltReference> };

interface BuiltOperation {
  readonly id: string;
  readonly name: Name;
  readonly provenance: Location;
  readonly requirements: BuiltRequirements;
  readonly inputs: BuiltFlow;
  readonly outputs: BuiltFlow;
}

type RelationshipSet =
  | { readonly _tag: "Closed"; readonly members: ReadonlyArray<string> }
  | { readonly _tag: "Open"; readonly members: ReadonlyArray<string>; readonly openedBy: ReadonlyArray<string> };

interface BuiltValue {
  readonly id: string;
  readonly name: Name;
  readonly provenance: Location;
  readonly producers: RelationshipSet;
  readonly consumers: RelationshipSet;
}

interface BuiltProfile {
  readonly name: string;
  readonly provenance: Location;
  readonly provided: ReadonlyArray<string>;
  readonly notProvided: ReadonlyArray<string>;
}

interface Built {
  readonly _tag: "Built";
  readonly profile: BuiltProfile;
  readonly required: ReadonlyArray<RequiredFact>;
  readonly operations: ReadonlyArray<BuiltOperation>;
  readonly values: ReadonlyArray<BuiltValue>;
}

type BuildOutcome =
  | Built
  | { readonly _tag: "Rejected"; readonly issues: ReadonlyArray<RejectionIssue> };
```

Every type is plain data: strings, numbers, booleans, arrays and records of these. No function, class, `Error`, `Map`, `Set` or Effect value appears anywhere.

**Declaration identity.** `id` is a non-empty string, unique within one analysis context. It is the only identity; `name` is a display name used in messages and never as identity. Identity across contexts is not defined in v0.4. Operation, value and capability ids are separate identity spaces: the same string may name one of each.

**Provenance and spans.** A span may be attached to a declaration, to each requirement, to a value, to each reference, and to the profile. Provenance is data; excerpts, line numbers, underlines and colours are the consumer's presentation.
- `source` is an opaque, non-empty source identity chosen by the producer. NEXUS never reads, resolves or opens it.
- `start` and `end` are offsets into the source text, counted in **UTF-16 code units**, zero-based; `start` is inclusive and `end` exclusive, so `start === end` marks a point.
- Offsets must be finite numbers other than `-0`, with `end >= start`. Finite offsets that are negative, fractional or beyond the source's length are accepted and passed through unchanged: NEXUS never reads the source, so it can't tell.
- Example: in `const e = "😀"; fs();`, the `😀` is one character but two UTF-16 code units, so `fs()` spans `{ start: 16, end: 20 }` and `text.slice(16, 20) === "fs()"`. Counting code points would give 15.

**Target requirements.** The one semantic property in v0.4.
- Absent `requirements`: the property is **unknown**. Unknown never means empty, false or safe.
- `complete`: the operation requires exactly the distinct capabilities listed. An empty complete list is the known fact "requires nothing".
- `partial`: it requires at least those, possibly others. An empty partial list says nothing definite.
- `capabilities` lists occurrences; the requirement *set* is the distinct `capability` values. Duplicates are valid: they are evaluated once, never produce extra findings, and each occurrence's provenance is kept, in order.

**Targets and bindings (v0.7, D43–D45).** The semantic model defines a *relation*, not a vocabulary and not a kind of environment.
- A **target** is the one provider an analysis context is evaluated against. A `TargetProfile` states that provider's provisions. It is not a browser, Node, a server or any other named environment: NEXUS names none.
- A **capability identifier** is an opaque string with no meaning of its own. Its meaning comes from the **binding** that produced the context: what kind of provider the profile describes, and whose identifiers the requirements name.
- **One context, one binding** (C22). A context's requirements and profile belong to the same binding. Identifiers from different bindings are never mixed in one analysis.
- v0.7 defines one binding, the **platform binding** (D44):
  - the requirement side names application [`Capability`](./primitives/capability.md) ids, **verbatim**;
  - the profile is a platform's **provision statement**: a claim the platform authors about what every start of it resolves.
  - There is no mapping table, prefix or transformation. `Capability.define("acme.storage")` is the semantic identifier `"acme.storage"`.
- PORT rendering-target capabilities are not part of the platform binding. A future binding may give them their own identifiers and their own contexts (L1).

**Analysis is independent of resolution** (I15, revised in v0.7). Analysis never reads, resolves or produces an application capability's resolution. A running application's `Environment` never makes an identifier provided, not provided or required. A profile is never derived from a `Layer`, an `Environment` or execution. The shared `Capability.id` identifies the capability *contract* both statements are about. It does not make these the same thing:

| | What it is | Where it lives |
|---|---|---|
| capability contract | `id` plus a typed `Shape` | `Capability.define`, by whoever defines the contract |
| requirement | a claim: this operation can't work unless the contract resolves `Available` | a declaration's `requirements` |
| platform statement | a claim: every start of this platform resolves these ids `Available`, and those not `Available` | a `TargetProfile` |
| runtime `Environment` | the fact, for one start | built by the platform `Layer` at `Application.start` |
| PORT target capability | a rendering-realization guarantee | PORT, in a separate binding (not modeled) |

**Target profiles.** Explicit input only: NEXUS never discovers, probes or derives a profile. For each capability it decides, a profile says **provided** or **not provided**; a capability in neither list is **undecided**, never "not provided". Undecided is the right answer for anything conditional (permissions, optional hardware, remote state, user configuration). NEXUS ships no predefined capability identifiers or profiles.

## API

```ts
function build(context: AnalysisContext): BuildOutcome;
function analyze(context: AnalysisContext): AnalysisOutcome;
```

`analyze` is a plain, synchronous, pure function, not an Effect. It returns `Rejected` for a malformed context (see Rejection) and `Analyzed` otherwise. It never throws on input satisfying these types.

`build` validates a context and returns the semantic IR (`Built`) or `Rejected`. It is the only place a context is validated. `analyze` is `build` followed by the compatibility pass, which reads only `Built`, so the two agree on every rejection.

`Analyzed` holds the property set considered (`["target-requirements"]`), the required facts (`[]` or `["target-compatibility"]`), the profile's name, one `OperationResult` per declaration in order, and the diagnostics.

**Verdicts and classification.** For each declaration, the first matching step applies:

| Step | When | Verdict | Classification |
|---|---|---|---|
| 1 | requirements declared, and some required capability is **not provided** | `Incompatible`, listing those capabilities | incompatible |
| 2 | requirements absent | `Undetermined`, cause `operation`, `undeclared` | opaque |
| 3 | requirements `partial` | `Undetermined`, cause `operation`, `partial` | opaque |
| 4 | some required capability is undecided | `Undetermined`, cause `target`, listing those capabilities | opaque |
| 5 | requirements `complete`, and every one provided (including none) | `Compatible` | supported |

*Opaque* means NEXUS cannot establish compatibility. It never means invalid, unsafe or incompatible, and an opaque operation executes exactly as it would without analysis. *Incompatible* requires both a declared requirement and the profile explicitly saying the capability is not provided. Missing information never produces an incompatible verdict or an error.

The result is authoritative: the verdict carries every fact a diagnostic states, so no consumer needs to parse a message.

## Rejection

A context is malformed exactly when it has one of these, and then the outcome is `{ _tag: "Rejected", issues }` with no operations and no diagnostics:

| `reason` | When |
|---|---|
| `duplicate-identity` | a value's or a declaration's `id` equals an earlier one's in the same list (reported at every later occurrence) |
| `missing-identity` | a value's or a declaration's `id` is absent or empty |
| `invalid-span` | a span's `start` or `end` isn't a finite number or is `-0`, or `end < start`, or its `source` is empty — on a declaration, a value, a requirement, a reference or the profile (one issue per span) |
| `empty-capability` | a requirement's `capability`, or an entry of `provided` or `notProvided`, is empty |
| `conflicting-decision` | a capability is both provided and not provided (reported once per capability, at its first `notProvided` index) |
| `unresolved-reference` | an input or output reference names no declared value (including `""`) |

Issues are listed in a fixed order: each value (identity, provenance); then each declaration (identity, provenance, each requirement's capability and provenance, then each input and output reference's value and provenance); then the profile's provenance, `provided`, `notProvided`, and conflicts. A context without values, inputs or outputs gives exactly v0.4's issues. `path` locates each issue in the input, for example `["declarations", 2, "requirements", "capabilities", 0, "provenance"]`.

A rejection is not a diagnostic: it describes malformed input, not a finding about an operation, and it has no code, severity, message or location. Everything else is well-formed, including no declarations, declarations with no facts, empty requirement lists, profiles that decide nothing, unknown capability identifiers, and empty display or profile names.

## Diagnostics

A diagnostic is derived from a classification. It is plain data and survives a JSON round trip unchanged.

| Code | Severity | Emitted when | Related spans |
|---|---|---|---|
| `nexus-incompatible-target-capability` | `error` | the operation is incompatible — always | each not-provided requirement's span, then the profile's span |
| `nexus-opaque-operation` | `warning` | opaque, cause `operation`, **and** `target-compatibility` is required | none |
| `nexus-undetermined-target-capability` | `warning` | opaque, cause `target`, **and** `target-compatibility` is required | each undecided requirement's span |

- A supported operation never has a diagnostic. An opaque one has a warning only when the context requires `target-compatibility`; otherwise its classification alone records the opacity.
- Each operation has at most one diagnostic, and diagnostics follow declaration order.
- `location` is the declaration's span, or `{ _tag: "Unlocated" }` when the declaration has none. An unlocated diagnostic is complete; it identifies its operation by `subject` and never borrows another span.
- `subject` is the operation's `id`, so each diagnostic joins to its `OperationResult`.
- Match on `code`, never on `message`. Messages and notes explain in prose and may change between versions.
- A code and severity state what analysis established, never what a consumer should do. There are no fixes, suppressions or severity settings.

## Data flow

Values are declared, alongside declarations: `id`, an optional `name`, and optional provenance. A declaration's `inputs` and `outputs` reference values by identity, and every reference must resolve — an identity that names no declared value is rejected as `unresolved-reference`, never treated as an implicit new value.

Each side of an operation — its inputs, its outputs — is one of three states, and `Semantic.build` keeps them distinct:

| Input | In `Built` | Meaning |
|---|---|---|
| absent | `Unknown` | no fact declared |
| `complete`, no references | `Declared { completeness: "complete", references: [] }` | consumes or produces nothing |
| `partial`, no references | `Declared { completeness: "partial", references: [] }` | a declared fact that identifies no specific values; it keeps the side open |

A value's producer set and consumer set are each **closed** or **open**. Closed means complete within this analysis context: every operation's corresponding fact (outputs, for producers; inputs, for consumers) is `complete`. Open is a lower bound — `openedBy` lists exactly the operations whose fact on that side is unknown or partial, and the set's `members` are known producers or consumers so far, not all of them. Closed-empty ("no operation in this context produces this value") and open-empty ("an unknown or partial operation might") are different tags and must not be confused.

Openness is uniform: every value in a context shares the same producer openness as every other value, and likewise for consumer openness, because one unknown or partial fact could involve any value. There is no per-value openness in v0.5.

**May-flow is producers × consumers.** `(P, v, C)` holds exactly when `P` is among `v`'s producer members and `C` is among its consumer members, including a self edge when one operation both produces and consumes `v`. A value with several producers gives an edge from every producer to every consumer. May-flow is never ordering: it says nothing about which operation runs first, whether both run, or which producer wrote the value a consumer sees. No edge list is stored — every edge is derived from the two sets' membership when asked.

```ts
import { Semantic } from "@valancex/nexus";

const built = Semantic.build({
  values: [{ id: "cart" }],
  declarations: [
    { id: "addItem", outputs: { completeness: "complete", references: [{ value: "cart" }] }, inputs: { completeness: "complete", references: [] } },
    { id: "removeItem", outputs: { completeness: "complete", references: [{ value: "cart" }] }, inputs: { completeness: "complete", references: [] } },
    { id: "clear", outputs: { completeness: "complete", references: [{ value: "cart" }] }, inputs: { completeness: "complete", references: [] } },
    { id: "checkout", inputs: { completeness: "complete", references: [{ value: "cart" }] }, outputs: { completeness: "complete", references: [] } },
  ],
  profile: { name: "example", provided: [], notProvided: [] },
});

// built._tag === "Built"
// cart's producers: Closed { members: ["addItem", "removeItem", "clear"] }
// cart's consumers: Closed { members: ["checkout"] }
// may-flow: (addItem, cart, checkout), (removeItem, cart, checkout), (clear, cart, checkout)
```

NEXUS understands declarations, not implementations. A value or a reference is never inferred from a name, an operation identity, or a primitive; it exists only because a declaration named it. Associating a declaration with the code it describes — a command handler, a service method — is outside the semantic model. It is the author's concern.

## Rules

- **Declared facts only.** NEXUS treats a property as known only when the declaration states it. It infers nothing from code, names, types, schemas or configuration.
- **No execution.** Analysis runs no handler, layer, service, selector, resource or binding, and needs no started application or runtime.
- **Purity.** `analyze` reads only the fields these types declare — no enumeration, iteration protocol, writes or calls on its input — and reads no clock, environment, file or network. It keeps no state between calls, and equal contexts give equal outcomes. Every output value is fresh: no output span is an input object, and extra properties on input spans are not carried over. A getter on a declared field is the caller's own code and runs when that field is read.
- **No gating.** Nothing in NEXUS consults an analysis result: no start, admission, run or dispatch depends on it, and no diagnostic enters an Effect error channel.
- **Independence.** The module imports nothing, and no primitive, lifecycle or the MESH adapter imports it. MESH diagnostics stay MESH's; NEXUS codes all begin `nexus-`.
- **Plain data.** Every result, diagnostic and rejection is JSON-compatible plain data.

## Example

```ts
import { Capability, Semantic } from "@valancex/nexus";

// A capability contract, defined by the application (or a shared contract module).
const AssetStore = Capability.define<AssetStoreShape>("acme.asset-store");

const outcome = Semantic.analyze({
  declarations: [
    // Can't work without AssetStore: a requirement (necessity, D46).
    { id: "save-asset", name: "Save", provenance: { source: "app.ts", start: 120, end: 180 },
      requirements: { completeness: "complete", capabilities: [{ capability: AssetStore.id }] } },
    // Uses AssetStore only with a fallback: it requires nothing.
    { id: "preview", requirements: { completeness: "complete", capabilities: [] } },
    { id: "send-report" },
  ],
  // A platform's provision statement, authored by that platform (D47).
  profile: { name: "example-platform", provided: [], notProvided: [AssetStore.id] },
  require: ["target-compatibility"],
});

// outcome._tag === "Analyzed"
// save-asset:  incompatible, one nexus-incompatible-target-capability error at app.ts 120–180
// preview:     supported
// send-report: opaque (requirements undeclared), one nexus-opaque-operation warning, unlocated
```

The identifiers are illustrative; NEXUS defines no capability vocabulary. The verdict is a statement about two claims. It doesn't start, stop or change anything: the application starts on that platform exactly as it would without analysis, and `Capability.resolve` returns whatever the platform's `Layer` supplies.

## Testing

`tests/semantic.test.ts` covers the model, rejection, each classification, diagnostics, freshness, JSON round trips and span semantics; `tests/semantic-isolation.test.ts` covers purity and independence from execution, application capabilities, MESH and the lifecycle; `tests/semantic-types.test.ts` pins the plain-data boundary at compile time; `tests/architecture.test.ts` enforces the leaf boundary. `tests/semantic-build.test.ts` covers the three data-flow states, values and references, provenance, openness and may-flow, and that `Built` is pure, deterministic and plain; `tests/semantic-compatibility.test.ts` checks `Semantic.analyze` against the released v0.4 module for every v0.4-shaped context, and that data-flow facts never affect compatibility; `tests/semantic-no-primitives.test.ts` builds and analyzes a context with every executable primitive module removed. `tests/capability-model.test.ts` pins the platform binding (v0.7): verdicts and diagnostics for capability ids, necessity, exact identity, and independence of the verdict from start and resolution.

## What analysis cannot know

Every NEXUS work unit — a command handler, a service, a selector projection, a resource function — is an opaque JavaScript closure, and Effect's type parameters are erased at runtime. v0.4 therefore reasons only about operations presented to it with declarations. When a whole closure is declared as one operation, that operation is the unit, and nothing inside it is visible. This is a deliberate boundary (outline D1).

## Not decided

These are open, and nothing here presumes an answer: how NEXUS, PORT and targets relate, and where production profiles come from (L1); a PORT binding, and any relation between bindings (L1); what a consumer does with an `error` (L3); identity stability across contexts (L4, which matters more now that values exist — every identity stays context-local in v0.5); producing declarations and spans from source (L5); and per-value openness — scoping an open or partial fact to particular values, instead of opening every value's producer and consumer sets together, deferred until a pass needs it. What a target profile denotes (L6) is resolved in v0.7: the provider of the context's binding (D43; [v0.7 outline](./superpowers/specs/2026-09-27-nexus-v0.7-outline.md)). How a declaration attaches to a NEXUS primitive (L2) is resolved: declarations are canonical and standalone, and association is the author's concern (D17). Later work — whole-plan validation, capture and tooling — is described in the v0.4 outline's §14 and is not part of v0.5.
