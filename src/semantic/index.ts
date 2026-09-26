/**
 * The semantic model (v0.4): plain-data semantic declarations, evaluated
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

/** A semantic declaration (C1). Absent `requirements` means unknown, never empty. */
export interface Declaration {
  readonly id: string;
  readonly name?: string;
  readonly provenance?: Span;
  readonly requirements?: TargetRequirements;
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

/** One analysis: declarations, one profile, and the facts required established (C7). */
export interface AnalysisContext {
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

/** Why a context is malformed (D6). A rejection is not a diagnostic. */
export type RejectionReason =
  | "duplicate-identity"
  | "missing-identity"
  | "invalid-span"
  | "empty-capability"
  | "conflicting-decision";

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

const allProvided = (ids: ReadonlyArray<string>, decisions: Decisions): boolean => {
  for (let i = 0; i < ids.length; i++) {
    if (!decisions.provided.has(ids[i] as string)) return false;
  }
  return true;
};

// C4. Provisional where the verdict steps aren't in place yet: opaque, never incompatible (I12).
const verdictOf = (requirements: TargetRequirements | undefined, decisions: Decisions): Verdict => {
  if (requirements !== undefined && requirements.completeness === "complete" && allProvided(distinctIds(requirements), decisions)) {
    return { _tag: "Compatible" };
  }
  return { _tag: "Undetermined", cause: "operation", requirements: "undeclared" };
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

/** Analyzes declarations against one target profile, without executing anything (C7). */
export const analyze = (context: AnalysisContext): AnalysisOutcome => {
  const issues = rejectionIssues(context);
  if (issues.length > 0) return { _tag: "Rejected", issues };

  const decisions = decisionsOf(context.profile);
  const operations: Array<OperationResult> = [];
  const declarations = context.declarations;
  for (let i = 0; i < declarations.length; i++) {
    operations.push(analyzeDeclaration(declarations[i] as Declaration, decisions));
  }

  return {
    _tag: "Analyzed",
    properties: ["target-requirements"],
    required: requiresCompatibility(context.require) ? ["target-compatibility"] : [],
    profile: context.profile.name,
    operations,
    diagnostics: [],
  };
};
