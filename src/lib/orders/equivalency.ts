import { serviceCents } from "./addons";
import { orderHasEvaluation } from "./service-selection";
import { isTranslationBundle } from "./evaluation-price";
import type { EvaluationResult } from "./types";

export const PENDING_EQUIVALENCY = "Pending staff review";
export const EQUIVALENCY_UNMAPPED = "equivalency_unmapped";
/** Matched suggestion is confident enough for staff to confirm. */
export const EQUIVALENCY_QA_REVIEW = "equivalency_qa_review";
/** Low confidence, or no equivalency row. Staff has to research it. */
export const EQUIVALENCY_QA_RESEARCH = "equivalency_qa_research";

const EQUIVALENCY_HOLDS = new Set([EQUIVALENCY_UNMAPPED, EQUIVALENCY_QA_REVIEW, EQUIVALENCY_QA_RESEARCH]);
const CONFIDENCE_LABEL = /^(high|medium|low)$/i;

export function awaitingEquivalencyPublish(reason: string | null): boolean {
  return reason != null && EQUIVALENCY_HOLDS.has(reason);
}

export function containsEdgeMarker(value: string): boolean {
  return /\bEDGE\b/i.test(value);
}

/** Internal routing stays off the customer order payload. */
export function customerReviewReason(reason: string | null): string | null {
  if (!reason) return null;
  if (EQUIVALENCY_HOLDS.has(reason)) return null;
  if (containsEdgeMarker(reason) || CONFIDENCE_LABEL.test(reason.trim())) return null;
  return reason;
}

/** Words that name an internal score or the page-order / equivalency basis. */
const PARTNER_HIDDEN = /\b(?:confidence|basis)\b/i;

/** Partner reads keep a routing code, and drop a reason that names the reference, a score, or a basis. */
export function partnerReviewReason(reason: string | null): string | null {
  if (!reason) return null;
  if (containsEdgeMarker(reason) || CONFIDENCE_LABEL.test(reason.trim())) return null;
  if (PARTNER_HIDDEN.test(reason)) return null;
  return reason;
}

export function customerEquivalencyText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || containsEdgeMarker(trimmed) || CONFIDENCE_LABEL.test(trimmed)) return PENDING_EQUIVALENCY;
  return trimmed;
}

export function customerGradeScale(value: string): string {
  if (containsEdgeMarker(value)) return "Grades use the printed scale.";
  return value;
}

function omitBasis<T extends { equivalencyBasis?: string }>(value: T): Omit<T, "equivalencyBasis"> {
  const copy = { ...value };
  delete copy.equivalencyBasis;
  return copy;
}

/** Copy shown to customers. Drops the internal basis and any reference wording. */
export function customerEvaluationResult(result: EvaluationResult): EvaluationResult {
  if (result.kind === "diploma") {
    return {
      ...result,
      credentials: result.credentials.map((credential) => {
        const rest = omitBasis(credential);
        return { ...rest, usEquivalency: customerEquivalencyText(rest.usEquivalency) };
      }),
    };
  }
  const rest = omitBasis(result);
  return {
    ...rest,
    gradeScale: customerGradeScale(rest.gradeScale),
    ...(rest.usEquivalency ? { usEquivalency: customerEquivalencyText(rest.usEquivalency) } : {}),
  };
}

export function diplomaEquivalencyPending(
  credentials: Array<{ usEquivalency: string; country?: string; field?: string; dates?: string }>,
): boolean {
  return credentials.some((credential) =>
    [credential.usEquivalency, credential.country, credential.field, credential.dates].some(
      (value) => value === PENDING_EQUIVALENCY,
    ),
  );
}

const EVALUATION_NOT_PAYABLE = new Set(["paid", "approved", "delivered", "cancelled"]);

/**
 * A credential evaluation can pay at its flat fee as soon as the type is chosen.
 * A translation still waits for a confirmed preview.
 */
export function checkoutBlockReason(
  order: Parameters<typeof serviceCents>[0] & {
    status: string;
    languageConfirmed: boolean;
    degreeCount?: number | null;
    addonCents?: number;
    includeTranslation?: boolean | null;
    orderType?: string | null;
    serviceType?: string | null;
  },
): "Preview is not ready" | "This order is not ready to pay" | null {
  if (isTranslationBundle(order)) {
    if (order.status !== "preview_ready") return "Preview is not ready";
    const base = serviceCents(order);
    if (!order.languageConfirmed || base == null) return "This order is not ready to pay";
    return null;
  }
  if (orderHasEvaluation(order) && order.degreeCount != null && order.degreeCount >= 1) {
    if (EVALUATION_NOT_PAYABLE.has(order.status)) return "This order is not ready to pay";
    return null;
  }
  if (order.status !== "preview_ready") return "Preview is not ready";
  const base = serviceCents(order);
  if (!order.languageConfirmed || base == null) return "This order is not ready to pay";
  return null;
}

export function approvalBlockReason(order: {
  reviewReason: string | null;
}): "The U.S. equivalency is still pending staff review" | null {
  if (awaitingEquivalencyPublish(order.reviewReason)) {
    return "The U.S. equivalency is still pending staff review";
  }
  return null;
}

export function onStaffReviewQueue(order: { status: string; reviewReason: string | null }): boolean {
  if (awaitingEquivalencyPublish(order.reviewReason) && order.status !== "cancelled") return true;
  return order.status === "needs_review" || order.status === "correction_requested";
}
