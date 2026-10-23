/**
 * `orders.review_reason` is the yellow "Needs review" banner on the admin order page.
 * Delivery finishes that review, so every delivery write clears the column.
 */
export const DELIVERED_REVIEW_CLEAR = { review_reason: null } as const;

/**
 * Banner text for the admin order page.
 * A delivered order is finished even when `review_reason` was left set.
 */
export function staffNeedsReviewBanner(order: {
  status: string;
  reviewReason: string | null;
  deliveryStatus?: string | null;
}): string | null {
  if (!order.reviewReason) return null;
  if (order.status === "delivered" || order.deliveryStatus === "delivered") return null;
  return order.reviewReason;
}

/** Staff-facing Review column. Known reasons pass through. Database errors do not. */
export function humanReviewReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  const text = reason.trim();
  if (!text) return null;
  if (text === "translation_timeout") return "Translation timed out before it could finish.";
  if (/order_qa_runs_order_attempt_key/i.test(text)) {
    return "Quality check was already recorded for this attempt.";
  }
  if (/skip_reason/i.test(text)) {
    return "Page skip could not be saved. The skip reason field is missing.";
  }
  if (/duplicate key|violates unique constraint/i.test(text)) {
    return "A duplicate record blocked this step.";
  }
  if (/(column|relation)\b/i.test(text) && /does not exist/i.test(text)) {
    return "A database update failed. The order needs another look.";
  }
  return text;
}
