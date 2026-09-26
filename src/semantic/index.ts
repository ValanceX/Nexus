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

export const analyze = (_context: AnalysisContext): AnalysisOutcome => ({ _tag: "Rejected", issues: [] });
