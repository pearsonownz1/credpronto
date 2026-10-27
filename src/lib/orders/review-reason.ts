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
  return humanReviewReason(order.reviewReason);
}

const REVIEW_REASON_COPY: Record<string, string> = {
  image_quality: "The uploaded photo needs a clearer retake so every line of the document can be read.",
  translation_timeout: "Translation timed out before it could finish.",
  low_confidence_language: "The source language could not be confirmed with enough confidence.",
  unsupported_language: "The detected source language is not supported for automatic translation.",
  equivalency_qa_review: "Credential evaluation is reviewed by staff.",
  equivalency_qa_research: "Credential evaluation needs additional research before it can be published.",
  equivalency_unmapped: "Credential evaluation could not map every entry automatically.",
};

/** Staff-facing Review column. Snake_case enums become sentences. Database errors do not pass through. */
export function humanReviewReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  const text = reason.trim();
  if (!text) return null;
  const mapped = REVIEW_REASON_COPY[text];
  if (mapped) return mapped;
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(text)) {
    return text
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
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
