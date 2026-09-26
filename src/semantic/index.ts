/**
 * The semantic model (v0.4, v0.5): plain-data semantic declarations, evaluated
 * against an explicit target profile, without executing anything.
 *
 * Every type here is plain data. `analyze` is a pure, synchronous function:
 * it reads only the fields these types declare, never calls a value it is
 * given, and returns fresh data. It has no dependency on any other module.
 */

/**
 * A region of one source (C2). Offsets count UTF-16 code units from zero;
 * `start` is inclusive and `end` exclusive, so `start === end` is a point.
 * Offsets must be finite numbers other than `-0`, with `end >= start` (D6).
 */
export interface Span {
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

/** One occurrence in an operation's target requirements (C4). */
export interface Requirement {
  readonly capability: string;
  readonly provenance?: Span;
}

/**
 * The operation's target requirements (C3, C4). `complete`: exactly the
 * distinct capabilities listed. `partial`: at least those.
 */
export interface TargetRequirements {
  readonly completeness: "complete" | "partial";
  readonly capabilities: ReadonlyArray<Requirement>;
}

/** A declared semantic value (C8): an identity operations may consume or produce. */
export interface ValueDeclaration {
  readonly id: string;
  readonly name?: string;
  readonly provenance?: Span;
}

/** One occurrence of a value in an operation's inputs or outputs (C8). */
export interface ValueReference {
  readonly value: string;
  readonly provenance?: Span;
}

/**
 * An operation's inputs or outputs (C8). `complete`: exactly the distinct
 * values listed, so none means "nothing". `partial`: at least those, so none
 * means only that no specific value is known.
 */
export interface DataFlow {
  readonly completeness: "complete" | "partial";
  readonly references: ReadonlyArray<ValueReference>;
}

/**
 * A semantic declaration (C1, C8). Absent `requirements`, `inputs` or
 * `outputs` means unknown, never empty.
 */
export interface Declaration {
  readonly id: string;
  readonly name?: string;
  readonly provenance?: Span;
  readonly requirements?: TargetRequirements;
  readonly inputs?: DataFlow;
  readonly outputs?: DataFlow;
}

/**
 * An explicit target profile (C4). A capability in neither list is
 * undecided; one in both is malformed (D6).
 */
export interface TargetProfile {
  readonly name: string;
  readonly provenance?: Span;
  readonly provided: ReadonlyArray<string>;
  readonly notProvided: ReadonlyArray<string>;
}

/** The v0.4 property set (C3). */
export type Property = "target-requirements";

/** The only fact a consumer can require established (C5). */
export type RequiredFact = "target-compatibility";

/** One analysis: values, declarations, one profile, and the facts required established (C7, C8). */
export interface AnalysisContext {
  readonly values?: ReadonlyArray<ValueDeclaration>;
  readonly declarations: ReadonlyArray<Declaration>;
  readonly profile: TargetProfile;
  readonly require?: ReadonlyArray<RequiredFact>;
}

/** The compatibility verdict, with its cause (C4). */
export type Verdict =
  | { readonly _tag: "Compatible" }
  | { readonly _tag: "Incompatible"; readonly notProvided: ReadonlyArray<string> }
  | { readonly _tag: "Undetermined"; readonly cause: "operation"; readonly requirements: "undeclared" | "partial" }
  | { readonly _tag: "Undetermined"; readonly cause: "target"; readonly undecided: ReadonlyArray<string> };

/** Derived from the verdict, one to one (C5). */
export type Classification = "supported" | "opaque" | "incompatible";

/** The result for one declaration (C7). */
export interface OperationResult {
  readonly id: string;
  readonly known: ReadonlyArray<Property>;
  readonly verdict: Verdict;
  readonly classification: Classification;
}

/** The v0.4 diagnostic codes (C6, D12). Match on these, never on `message`. */
export type DiagnosticCode =
  | "nexus-incompatible-target-capability"
  | "nexus-opaque-operation"
  | "nexus-undetermined-target-capability";

export type Severity = "warning" | "error";

/** A primary span, or explicitly none (C2). */
export type Location =
  | { readonly _tag: "Span"; readonly span: Span }
  | { readonly _tag: "Unlocated" };

export interface RelatedSpan {
  readonly span: Span;
  readonly label: string;
}

/** One finding about one operation (C6). It states meaning, never an action. */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly message: string;
  readonly location: Location;
  readonly subject: string;
  readonly related: ReadonlyArray<RelatedSpan>;
  readonly notes: ReadonlyArray<string>;
}

/** Why a context is malformed (D6, C9). A rejection is not a diagnostic. */
export type RejectionReason =
  | "duplicate-identity"
  | "missing-identity"
  | "invalid-span"
  | "empty-capability"
  | "conflicting-decision"
  | "unresolved-reference";

export interface RejectionIssue {
  readonly reason: RejectionReason;
  readonly path: ReadonlyArray<string | number>;
}

/** Exactly one of a result or a rejection (C7). */
export type AnalysisOutcome =
  | {
      readonly _tag: "Analyzed";
      readonly properties: ReadonlyArray<Property>;
      readonly required: ReadonlyArray<RequiredFact>;
      readonly profile: string;
      readonly operations: ReadonlyArray<OperationResult>;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    }
  | { readonly _tag: "Rejected"; readonly issues: ReadonlyArray<RejectionIssue> };

/** A display name in the IR: present (even if empty), or explicitly absent (C10). */
export type Name =
  | { readonly _tag: "Named"; readonly name: string }
  | { readonly _tag: "Unnamed" };

export interface BuiltRequirement {
  readonly capability: string;
  readonly provenance: Location;
}

/** Target requirements in the IR: as declared, or explicitly unknown (C10). */
export type BuiltRequirements =
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Declared"; readonly completeness: "complete" | "partial"; readonly capabilities: ReadonlyArray<BuiltRequirement> };

export interface BuiltReference {
  readonly value: string;
  readonly provenance: Location;
}

/**
 * Inputs or outputs in the IR (C10). `Unknown`: nothing was declared.
 * `Declared`: the distinct values in first-occurrence order, and every
 * occurrence. A partial fact with no references stays `Declared`.
 */
export type BuiltFlow =
  | { readonly _tag: "Unknown" }
  | { readonly _tag: "Declared"; readonly completeness: "complete" | "partial"; readonly values: ReadonlyArray<string>; readonly references: ReadonlyArray<BuiltReference> };

export interface BuiltOperation {
  readonly id: string;
  readonly name: Name;
  readonly provenance: Location;
  readonly requirements: BuiltRequirements;
  readonly inputs: BuiltFlow;
  readonly outputs: BuiltFlow;
}

/**
 * A value's producers or consumers: operation ids in declaration order (C11).
 * `Closed`: complete within this context. `Open`: a lower bound; `openedBy`
 * lists the operations whose fact on that side is unknown or partial.
 */
export type RelationshipSet =
  | { readonly _tag: "Closed"; readonly members: ReadonlyArray<string> }
  | { readonly _tag: "Open"; readonly members: ReadonlyArray<string>; readonly openedBy: ReadonlyArray<string> };

export interface BuiltValue {
  readonly id: string;
  readonly name: Name;
  readonly provenance: Location;
  readonly producers: RelationshipSet;
  readonly consumers: RelationshipSet;
}

export interface BuiltProfile {
  readonly name: string;
  readonly provenance: Location;
  readonly provided: ReadonlyArray<string>;
  readonly notProvided: ReadonlyArray<string>;
}

/**
 * The semantic IR (C10, D24): a validated context as plain data. May-flow
 * (P, v, C) holds exactly when P is among v's producers and C among its
 * consumers. It is possible value provenance, never ordering (I22), and no
 * edge list is stored (C11).
 */
export interface Built {
  readonly _tag: "Built";
  readonly profile: BuiltProfile;
  readonly required: ReadonlyArray<RequiredFact>;
  readonly operations: ReadonlyArray<BuiltOperation>;
  readonly values: ReadonlyArray<BuiltValue>;
}

/** Exactly one of the IR or a rejection (C9). */
export type BuildOutcome =
  | Built
  | { readonly _tag: "Rejected"; readonly issues: ReadonlyArray<RejectionIssue> };

// Implementation notes. Caller arrays are walked only by index over `length`,
// and caller objects are read only through the fields the types above declare:
// nothing from the input is iterated, enumerated, spread, called or written.
// Every output value is built fresh.

type Path = ReadonlyArray<string | number>;

// D6 case 3: finite offsets other than -0, end >= start, and a non-empty source.
const isValidSpan = (span: Span): boolean => {
  const source = span.source;
  const start = span.start;
  const end = span.end;

  return Number.isFinite(start) && Number.isFinite(end) && !Object.is(start, -0) && !Object.is(end, -0) && !(end < start) && source !== "";
};

const checkSpan = (span: Span | undefined, path: Path, issues: Array<RejectionIssue>): void => {
  if (span !== undefined && !isValidSpan(span)) issues.push({ reason: "invalid-span", path });
};

const copySpan = (span: Span): Span => ({ source: span.source, start: span.start, end: span.end });

const locationOf = (span: Span | undefined): Location =>
  span !== undefined ? { _tag: "Span", span: copySpan(span) } : { _tag: "Unlocated" };

const copyLocation = (location: Location): Location =>
  location._tag === "Span" ? { _tag: "Span", span: copySpan(location.span) } : { _tag: "Unlocated" };

const nameOf = (name: string | undefined): Name =>
  name !== undefined ? { _tag: "Named", name } : { _tag: "Unnamed" };

// C1, D6 case 4: requirements as declared, or explicitly unknown.
const requirementsOf = (requirements: TargetRequirements | undefined, path: Path, issues: Array<RejectionIssue>): BuiltRequirements => {
  if (requirements === undefined) return { _tag: "Unknown" };

  const capabilities: Array<BuiltRequirement> = [];
  const list = requirements.capabilities;
  for (let j = 0; j < list.length; j++) {
    const requirement = list[j] as Requirement;
    const capability = requirement.capability;
    const provenance = requirement.provenance;

    if (capability === "") issues.push({ reason: "empty-capability", path: [...path, "capabilities", j, "capability"] });
    checkSpan(provenance, [...path, "capabilities", j, "provenance"], issues);
    capabilities.push({ capability, provenance: locationOf(provenance) });
  }
  return { _tag: "Declared", completeness: requirements.completeness, capabilities };
};

// C8, C9: absent stays Unknown (never an empty fact). Every reference must
// name a declared value, and every occurrence keeps its own provenance.
const flowOf = (flow: DataFlow | undefined, declared: ReadonlySet<string>, path: Path, issues: Array<RejectionIssue>): BuiltFlow => {
  if (flow === undefined) return { _tag: "Unknown" };

  const values: Array<string> = [];
  const seen = new Set<string>();
  const references: Array<BuiltReference> = [];
  const list = flow.references;
  for (let j = 0; j < list.length; j++) {
    const reference = list[j] as ValueReference;
    const value = reference.value;
    const provenance = reference.provenance;

    if (!declared.has(value)) issues.push({ reason: "unresolved-reference", path: [...path, "references", j, "value"] });
    checkSpan(provenance, [...path, "references", j, "provenance"], issues);
    if (!seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
    references.push({ value, provenance: locationOf(provenance) });
  }
  return { _tag: "Declared", completeness: flow.completeness, values, references };
};

// C11: one side of a value. It closes only when every operation's fact on that
// side is complete; unknown and partial facts (including partial-empty) open it.
// ponytail: O(operations × values × references); index by value if contexts grow large.
const relationshipSet = (operations: ReadonlyArray<BuiltOperation>, side: "inputs" | "outputs", value: string): RelationshipSet => {
  const members: Array<string> = [];
  const openedBy: Array<string> = [];
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i] as BuiltOperation;
    const flow = operation[side];

    if (flow._tag === "Declared" && flow.values.includes(value)) members.push(operation.id);
    if (flow._tag === "Unknown" || flow.completeness === "partial") openedBy.push(operation.id);
  }
  return openedBy.length === 0 ? { _tag: "Closed", members } : { _tag: "Open", members, openedBy };
};

// D6: every malformation, in the fixed traversal order.
const rejectionIssues = (context: AnalysisContext): ReadonlyArray<RejectionIssue> => {
  const issues: Array<RejectionIssue> = [];
  const checkSpan = (span: Span | undefined, path: Path) => {
    if (span !== undefined && !isValidSpan(span)) issues.push({ reason: "invalid-span", path });
  };

  const identities = new Set<string>();
  const declarations = context.declarations;
  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i] as Declaration;
    const id = declaration.id;

    if (typeof id !== "string" || id === "") {
      issues.push({ reason: "missing-identity", path: ["declarations", i, "id"] });
    } else if (identities.has(id)) {
      issues.push({ reason: "duplicate-identity", path: ["declarations", i, "id"] });
    } else {
      identities.add(id);
    }

    checkSpan(declaration.provenance, ["declarations", i, "provenance"]);

    const requirements = declaration.requirements;
    if (requirements !== undefined) {
      const capabilities = requirements.capabilities;
      for (let j = 0; j < capabilities.length; j++) {
        const requirement = capabilities[j] as Requirement;

        if (requirement.capability === "") {
          issues.push({ reason: "empty-capability", path: ["declarations", i, "requirements", "capabilities", j, "capability"] });
        }
        checkSpan(requirement.provenance, ["declarations", i, "requirements", "capabilities", j, "provenance"]);
      }
    }
  }

  const profile = context.profile;
  checkSpan(profile.provenance, ["profile", "provenance"]);

  const provided = new Set<string>();
  const providedList = profile.provided;
  for (let k = 0; k < providedList.length; k++) {
    const capability = providedList[k] as string;

    if (capability === "") issues.push({ reason: "empty-capability", path: ["profile", "provided", k] });
    else provided.add(capability);
  }

  const notProvidedList = profile.notProvided;
  const notProvided: Array<string> = [];
  for (let k = 0; k < notProvidedList.length; k++) {
    const capability = notProvidedList[k] as string;

    if (capability === "") issues.push({ reason: "empty-capability", path: ["profile", "notProvided", k] });
    notProvided.push(capability);
  }

  const conflicts = new Set<string>();
  for (let k = 0; k < notProvided.length; k++) {
    const capability = notProvided[k] as string;

    if (capability !== "" && provided.has(capability) && !conflicts.has(capability)) {
      conflicts.add(capability);
      issues.push({ reason: "conflicting-decision", path: ["profile", "notProvided", k] });
    }
  }

  return issues;
};

const requiresCompatibility = (require: ReadonlyArray<RequiredFact> | undefined): boolean => {
  if (require === undefined) return false;
  for (let i = 0; i < require.length; i++) {
    if (require[i] === "target-compatibility") return true;
  }
  return false;
};

// The profile's decisions, read once per analysis.
interface Decisions {
  readonly provided: ReadonlySet<string>;
  readonly notProvided: ReadonlySet<string>;
}

const decisionsOf = (profile: TargetProfile): Decisions => {
  const provided = new Set<string>();
  const notProvided = new Set<string>();
  const providedList = profile.provided;
  const notProvidedList = profile.notProvided;
  for (let k = 0; k < providedList.length; k++) provided.add(providedList[k] as string);
  for (let k = 0; k < notProvidedList.length; k++) notProvided.add(notProvidedList[k] as string);

  return { provided, notProvided };
};

// The distinct required ids, in order of first occurrence (plan P7).
const distinctIds = (requirements: TargetRequirements): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const ids: Array<string> = [];
  const capabilities = requirements.capabilities;
  for (let j = 0; j < capabilities.length; j++) {
    const capability = (capabilities[j] as Requirement).capability;
    if (!seen.has(capability)) {
      seen.add(capability);
      ids.push(capability);
    }
  }
  return ids;
};

// The ids a predicate selects, in order.
const selectIds = (ids: ReadonlyArray<string>, keep: (id: string) => boolean): ReadonlyArray<string> => {
  const selected: Array<string> = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as string;
    if (keep(id)) selected.push(id);
  }
  return selected;
};

// C4: the first matching step applies, and the five steps are exhaustive.
// Only a declared requirement the profile explicitly doesn't provide is
// incompatible (I16); missing or undecided information is opaque (I12).
const verdictOf = (requirements: TargetRequirements | undefined, decisions: Decisions): Verdict => {
  const ids = requirements !== undefined ? distinctIds(requirements) : [];

  const notProvided = selectIds(ids, (id) => decisions.notProvided.has(id));
  if (notProvided.length > 0) return { _tag: "Incompatible", notProvided };

  if (requirements === undefined) return { _tag: "Undetermined", cause: "operation", requirements: "undeclared" };
  if (requirements.completeness === "partial") return { _tag: "Undetermined", cause: "operation", requirements: "partial" };

  const undecided = selectIds(ids, (id) => !decisions.provided.has(id));
  if (undecided.length > 0) return { _tag: "Undetermined", cause: "target", undecided };

  return { _tag: "Compatible" };
};

const classificationOf = (verdict: Verdict): Classification =>
  verdict._tag === "Compatible" ? "supported" : verdict._tag === "Incompatible" ? "incompatible" : "opaque";

const analyzeDeclaration = (declaration: Declaration, decisions: Decisions): OperationResult => {
  const requirements = declaration.requirements;
  const verdict = verdictOf(requirements, decisions);

  return {
    id: declaration.id,
    known: requirements !== undefined ? ["target-requirements"] : [],
    verdict,
    classification: classificationOf(verdict),
  };
};

// The spans of the requirement occurrences whose ids are selected, in list order.
const requirementSpans = (requirements: TargetRequirements | undefined, selected: ReadonlyArray<string>): Array<RelatedSpan> => {
  const related: Array<RelatedSpan> = [];
  if (requirements === undefined) return related;

  const ids = new Set<string>();
  for (let i = 0; i < selected.length; i++) ids.add(selected[i] as string);

  const capabilities = requirements.capabilities;
  for (let j = 0; j < capabilities.length; j++) {
    const requirement = capabilities[j] as Requirement;
    const provenance = requirement.provenance;
    if (provenance !== undefined && ids.has(requirement.capability)) {
      related.push({ span: copySpan(provenance), label: "requirement declared here" });
    }
  }
  return related;
};

const quoted = (ids: ReadonlyArray<string>): string => {
  let text = "";
  for (let i = 0; i < ids.length; i++) text += (i === 0 ? "" : ", ") + "\"" + (ids[i] as string) + "\"";
  return text;
};

// C5 emission and C6. Messages explain; their wording is not a contract.
const diagnosticOf = (declaration: Declaration, verdict: Verdict, profile: TargetProfile, required: boolean): Diagnostic | undefined => {
  if (verdict._tag === "Compatible") return undefined;
  if (verdict._tag === "Undetermined" && !required) return undefined;

  const id = declaration.id;
  const name = declaration.name;
  const label = name !== undefined && name !== "" ? name : id;
  const provenance = declaration.provenance;
  const location: Location = provenance !== undefined ? { _tag: "Span", span: copySpan(provenance) } : { _tag: "Unlocated" };
  const profileName = profile.name;
  const requirements = declaration.requirements;

  if (verdict._tag === "Incompatible") {
    const related = requirementSpans(requirements, verdict.notProvided);
    const profileProvenance = profile.provenance;
    if (profileProvenance !== undefined) related.push({ span: copySpan(profileProvenance), label: "target profile declared here" });

    return {
      code: "nexus-incompatible-target-capability",
      severity: "error",
      message: `Operation "${label}" requires target capabilities that target profile "${profileName}" does not provide.`,
      location,
      subject: id,
      related,
      notes: [`Not provided by target profile "${profileName}": ${quoted(verdict.notProvided)}.`],
    };
  }

  if (verdict.cause === "operation") {
    return {
      code: "nexus-opaque-operation",
      severity: "warning",
      message: `NEXUS cannot establish target compatibility for operation "${label}".`,
      location,
      subject: id,
      related: [],
      notes: [
        verdict.requirements === "undeclared" ? "Its target requirements are undeclared." : "Its target requirements are declared as partial.",
        "The operation still executes normally.",
      ],
    };
  }

  return {
    code: "nexus-undetermined-target-capability",
    severity: "warning",
    message: `NEXUS cannot establish target compatibility for operation "${label}" against target profile "${profileName}".`,
    location,
    subject: id,
    related: requirementSpans(requirements, verdict.undecided),
    notes: [`Not decided by target profile "${profileName}": ${quoted(verdict.undecided)}.`],
  };
};

/** Analyzes declarations against one target profile, without executing anything (C7). */
export const analyze = (context: AnalysisContext): AnalysisOutcome => {
  const issues = rejectionIssues(context);
  if (issues.length > 0) return { _tag: "Rejected", issues };

  const profile = context.profile;
  const decisions = decisionsOf(profile);
  const required = requiresCompatibility(context.require);
  const operations: Array<OperationResult> = [];
  const diagnostics: Array<Diagnostic> = [];
  const declarations = context.declarations;
  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i] as Declaration;
    const operation = analyzeDeclaration(declaration, decisions);
    const diagnostic = diagnosticOf(declaration, operation.verdict, profile, required);

    operations.push(operation);
    if (diagnostic !== undefined) diagnostics.push(diagnostic);
  }

  return {
    _tag: "Analyzed",
    properties: ["target-requirements"],
    required: required ? ["target-compatibility"] : [],
    profile: profile.name,
    operations,
    diagnostics,
  };
};

/**
 * Validates a context once and builds its semantic IR (C9, C10, D24). The only
 * place a context is validated or a Built is constructed.
 */
export const build = (context: AnalysisContext): BuildOutcome => {
  const issues: Array<RejectionIssue> = [];

  // Values come first, so references can resolve (C9). Absent is empty (C8).
  const declared = new Set<string>();
  const valueHeads: Array<{ readonly id: string; readonly name: Name; readonly provenance: Location }> = [];
  const valueList = context.values;
  if (valueList !== undefined) {
    for (let i = 0; i < valueList.length; i++) {
      const value = valueList[i] as ValueDeclaration;
      const id = value.id;
      const provenance = value.provenance;

      if (typeof id !== "string" || id === "") issues.push({ reason: "missing-identity", path: ["values", i, "id"] });
      else if (declared.has(id)) issues.push({ reason: "duplicate-identity", path: ["values", i, "id"] });
      else declared.add(id);
      checkSpan(provenance, ["values", i, "provenance"], issues);
      valueHeads.push({ id, name: nameOf(value.name), provenance: locationOf(provenance) });
    }
  }

  // Declarations, in v0.4's order (identity, provenance, requirements), then inputs and outputs.
  const identities = new Set<string>();
  const operations: Array<BuiltOperation> = [];
  const declarations = context.declarations;
  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i] as Declaration;
    const id = declaration.id;
    const provenance = declaration.provenance;

    if (typeof id !== "string" || id === "") issues.push({ reason: "missing-identity", path: ["declarations", i, "id"] });
    else if (identities.has(id)) issues.push({ reason: "duplicate-identity", path: ["declarations", i, "id"] });
    else identities.add(id);
    checkSpan(provenance, ["declarations", i, "provenance"], issues);

    operations.push({
      id,
      name: nameOf(declaration.name),
      provenance: locationOf(provenance),
      requirements: requirementsOf(declaration.requirements, ["declarations", i, "requirements"], issues),
      inputs: flowOf(declaration.inputs, declared, ["declarations", i, "inputs"], issues),
      outputs: flowOf(declaration.outputs, declared, ["declarations", i, "outputs"], issues),
    });
  }

  // The profile, in v0.4's order: provenance, provided, notProvided, conflicts.
  const profile = context.profile;
  const profileProvenance = profile.provenance;
  checkSpan(profileProvenance, ["profile", "provenance"], issues);

  const provided: Array<string> = [];
  const providedSet = new Set<string>();
  const providedList = profile.provided;
  for (let k = 0; k < providedList.length; k++) {
    const capability = providedList[k] as string;

    if (capability === "") issues.push({ reason: "empty-capability", path: ["profile", "provided", k] });
    else providedSet.add(capability);
    provided.push(capability);
  }

  const notProvided: Array<string> = [];
  const notProvidedList = profile.notProvided;
  for (let k = 0; k < notProvidedList.length; k++) {
    const capability = notProvidedList[k] as string;

    if (capability === "") issues.push({ reason: "empty-capability", path: ["profile", "notProvided", k] });
    notProvided.push(capability);
  }

  const conflicts = new Set<string>();
  for (let k = 0; k < notProvided.length; k++) {
    const capability = notProvided[k] as string;

    if (capability !== "" && providedSet.has(capability) && !conflicts.has(capability)) {
      conflicts.add(capability);
      issues.push({ reason: "conflicting-decision", path: ["profile", "notProvided", k] });
    }
  }

  if (issues.length > 0) return { _tag: "Rejected", issues };

  const values: Array<BuiltValue> = [];
  for (let i = 0; i < valueHeads.length; i++) {
    const head = valueHeads[i] as (typeof valueHeads)[number];
    values.push({
      id: head.id,
      name: head.name,
      provenance: head.provenance,
      producers: relationshipSet(operations, "outputs", head.id),
      consumers: relationshipSet(operations, "inputs", head.id),
    });
  }

  return {
    _tag: "Built",
    profile: { name: profile.name, provenance: locationOf(profileProvenance), provided, notProvided },
    required: requiresCompatibility(context.require) ? ["target-compatibility"] : [],
    operations,
    values,
  };
};
