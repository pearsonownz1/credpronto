/** The shared letterhead rule sits this far below the top of the page. */
export const GCS_LETTERHEAD_RULE_FROM_TOP = 88;

/** Body ascenders stay at least this far below the letterhead rule. */
export const GCS_LETTERHEAD_BODY_CLEARANCE = 16;

export function gcsLetterheadRuleY(heightPt: number): number {
  return heightPt - GCS_LETTERHEAD_RULE_FROM_TOP;
}

/**
 * Extra space under the letterhead so translated text does not sit on the rule.
 * Form and transcript pages (`kind === null`) use the same inset as letters and
 * certificates. A level-1 heading is larger than the body size, and 34pt let
 * that heading cut through the rule.
 */
export function gcsBodyTopInset(_kind: "letter" | "certificate" | "form" | null): number {
  return 72;
}
