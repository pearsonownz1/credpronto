import { DELIVERED_REVIEW_CLEAR } from "./review-reason";
import { orderHasEvaluation } from "./service-selection";
import type { OrderRecord } from "./types";

/**
 * Columns that mark an evaluation finished when its order is delivered. The customer page
 * reads `evaluation_status` and only shows Ready once it says `evaluation_complete`.
 * Translation-only orders and evaluations already marked complete skip that stamp.
 * Delivery always clears `review_reason` so the staff banner does not stay up.
 */
export function deliveredEvaluationPatch(
  order: Pick<OrderRecord, "evaluationStatus"> & Parameters<typeof orderHasEvaluation>[0],
  at: string,
): Record<string, string | null> {
  if (!orderHasEvaluation(order) || order.evaluationStatus === "evaluation_complete") {
    return { ...DELIVERED_REVIEW_CLEAR };
  }
  return {
    evaluation_status: "evaluation_complete",
    evaluation_complete_at: at,
    ...DELIVERED_REVIEW_CLEAR,
  };
}
