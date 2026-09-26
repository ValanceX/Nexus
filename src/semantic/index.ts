/**
 * The semantic model (v0.4): plain-data semantic declarations, evaluated
 * against an explicit target profile, without executing anything.
 */
export const analyze = (_context: unknown): { readonly _tag: "Rejected"; readonly issues: ReadonlyArray<never> } =>
  ({ _tag: "Rejected", issues: [] });
