import { serviceCents } from "./addons";

export const PENDING_EQUIVALENCY = "Pending staff review";
export const EQUIVALENCY_UNMAPPED = "equivalency_unmapped";

export function diplomaEquivalencyPending(credentials: Array<{ usEquivalency: string }>): boolean {
  return credentials.some((credential) => credential.usEquivalency === PENDING_EQUIVALENCY);
}

/** Checkout stays open for a priced preview. The equivalency flag does not add a 409. */
export function checkoutBlockReason(
  order: Parameters<typeof serviceCents>[0] & {
    status: string;
    languageConfirmed: boolean;
  },
): "Preview is not ready" | "This order is not ready to pay" | null {
  if (order.status !== "preview_ready") return "Preview is not ready";
  const base = serviceCents(order);
  if (
    !order.languageConfirmed ||
    base == null ||
    (order.service != null && (order.evaluationCents == null || order.translationCents == null))
  ) {
    return "This order is not ready to pay";
  }
  return null;
}

export function approvalBlockReason(order: {
  reviewReason: string | null;
}): "The U.S. equivalency is still pending staff review" | null {
  if (order.reviewReason === EQUIVALENCY_UNMAPPED) {
    return "The U.S. equivalency is still pending staff review";
  }
  return null;
}

export function onStaffReviewQueue(order: { status: string; reviewReason: string | null }): boolean {
  if (order.reviewReason === EQUIVALENCY_UNMAPPED && order.status !== "cancelled") return true;
  return order.status === "needs_review" || order.status === "correction_requested";
}
