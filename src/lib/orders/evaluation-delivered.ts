import { orderHasEvaluation } from "./service-selection";
import type { OrderRecord } from "./types";

/**
 * Columns that mark an evaluation finished when its order is delivered. The customer page
 * reads `evaluation_status` and only shows Ready once it says `evaluation_complete`.
 * Empty for translation-only orders and for evaluations already marked complete.
 */
export function deliveredEvaluationPatch(
  order: Pick<OrderRecord, "evaluationStatus"> & Parameters<typeof orderHasEvaluation>[0],
  at: string,
): Record<string, string> {
  if (!orderHasEvaluation(order)) return {};
  if (order.evaluationStatus === "evaluation_complete") return {};
  return { evaluation_status: "evaluation_complete", evaluation_complete_at: at };
}
