import { addBusinessHours } from "./business-hours";
import { LOW_LANGUAGE_CONFIDENCE } from "./constants";
import type { QaStatus } from "./qa";

/** A first-attempt QA pass at or above this score is high confidence. The pass bar is 80. */
export const HIGH_QA_SCORE = 90;

/**
 * Second staff email when a flagged translation is still unapproved this long after paid_at.
 * Credential evaluations use {@link EVALUATION_URGENT_BUSINESS_HOURS} instead of this timer.
 */
export const URGENT_ALERT_DELAY_MS = 2 * 60 * 1000;

/**
 * One urgent staff email for a paid credential evaluation, counted in
 * America/Los_Angeles business hours (Mon–Fri 9:00am–5:00pm) from paid_at.
 */
export const EVALUATION_URGENT_BUSINESS_HOURS = 4;

/** Still waiting on a person. Anything else has left the staff queue. */
export const WAITING_FOR_STAFF_STATUSES = ["paid", "needs_review", "correction_requested"] as const;

export const DEFAULT_STAFF_ALERT_EMAILS = "support@credpronto.com,guyp@mail.grokbot.com";

export type FulfillmentState = "released" | "awaiting_review";

export type ReleaseAction = "release" | "staff" | "wait";

export type QaSignal = {
  status: QaStatus;
  score: number;
};

export type ReleaseInput = {
  status: string;
  reviewReason: string | null;
  qa: QaSignal | null;
  languageConfidence: number | null;
  pageNeedsReview: boolean;
  openCorrections: boolean;
  finalsReady: boolean;
  enabled: boolean;
  /** Paid credential evaluation. Staff uploads the report; nothing is generated automatically. */
  manualEvaluation?: boolean;
};

const UNAPPROVED = new Set<string>(WAITING_FOR_STAFF_STATUSES);

/** Default on. Set AUTO_RELEASE_ENABLED to 0, false, off, or no to stop releases immediately. */
export function autoReleaseEnabled(value: string | undefined = process.env.AUTO_RELEASE_ENABLED): boolean {
  if (value == null || value.trim() === "") return true;
  switch (value.trim().toLowerCase()) {
    case "0":
    case "false":
    case "off":
    case "no":
      return false;
    default:
      return true;
  }
}

/** Comma-separated override. An empty value keeps the default list. */
export function staffAlertRecipients(value: string | undefined = process.env.STAFF_ALERT_EMAILS): string[] {
  const source = value == null || value.trim() === "" ? DEFAULT_STAFF_ALERT_EMAILS : value;
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const part of source.split(",")) {
    const email = part.trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }
  return recipients;
}

/** Clean first pass. A later pass is `retranslated` and stays with a person. */
export function qaHighConfidence(qa: QaSignal | null): boolean {
  return qa != null && qa.status === "pass" && qa.score >= HIGH_QA_SCORE;
}

/** At or above the existing low-confidence cutoff. */
export function languageConfidenceHigh(confidence: number | null): boolean {
  return confidence != null && confidence >= LOW_LANGUAGE_CONFIDENCE;
}

function flagged(input: ReleaseInput): boolean {
  if (input.reviewReason?.trim()) return true;
  if (input.pageNeedsReview || input.openCorrections) return true;
  if (!languageConfidenceHigh(input.languageConfidence)) return true;
  if (input.qa && !qaHighConfidence(input.qa)) return true;
  return false;
}

/**
 * `release` — QA passed with high confidence and nothing is flagged.
 * `wait` — paid, not flagged, and the certified PDF is not stored yet.
 * `staff` — a person has to approve it.
 */
export function releaseAction(input: ReleaseInput): ReleaseAction {
  if (input.status === "approved" || input.status === "delivered") return "release";
  if (!UNAPPROVED.has(input.status)) return "wait";
  if (input.manualEvaluation) return "staff";
  if (!input.enabled) return "staff";
  const held = flagged(input);
  if (input.status === "paid" && !held && input.finalsReady && qaHighConfidence(input.qa)) return "release";
  if (input.status === "paid" && !held && !input.finalsReady) return "wait";
  return "staff";
}

/** Front-end flag. Released orders are certified. Paid orders that are not released are waiting. */
export function fulfillmentState(order: { status: string; paidAt?: string | null }): FulfillmentState | null {
  if (order.status === "approved" || order.status === "delivered") return "released";
  if (order.status === "paid") return "awaiting_review";
  if (order.paidAt && (order.status === "needs_review" || order.status === "correction_requested")) {
    return "awaiting_review";
  }
  return null;
}

/**
 * One urgent email, two minutes after paid_at, and only after the first alert.
 * Credential evaluations, including those with a bundled translation, are not on this timer.
 */
export function urgentAlertDue(input: {
  status: string;
  paidAt: string | null;
  staffAlertSentAt: string | null;
  staffUrgentAlertSentAt: string | null;
  now: number;
  service?: string | null;
}): boolean {
  if (input.service) return false;
  if (!UNAPPROVED.has(input.status)) return false;
  if (!input.paidAt || !input.staffAlertSentAt || input.staffUrgentAlertSentAt) return false;
  const paid = Date.parse(input.paidAt);
  if (!Number.isFinite(paid)) return false;
  return input.now - paid >= URGENT_ALERT_DELAY_MS;
}

/**
 * One urgent email for a credential evaluation that is still waiting on staff.
 * Due four Los Angeles business hours after paid_at. `staff_urgent_alert_sent_at`
 * keeps it to a single send. A bundled translation uses the same wait.
 */
export function evaluationUrgentDue(input: {
  status: string;
  paidAt: string | null;
  staffAlertSentAt: string | null;
  staffUrgentAlertSentAt: string | null;
  now: number;
  service?: string | null;
}): boolean {
  if (!input.service) return false;
  if (!UNAPPROVED.has(input.status)) return false;
  if (!input.paidAt || !input.staffAlertSentAt || input.staffUrgentAlertSentAt) return false;
  const paid = Date.parse(input.paidAt);
  if (!Number.isFinite(paid)) return false;
  return input.now >= addBusinessHours(paid, EVALUATION_URGENT_BUSINESS_HOURS);
}
