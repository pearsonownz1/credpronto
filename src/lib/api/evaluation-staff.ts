/** Shown when GET /api/admin/orders?queue=evaluation is not deployed yet. */
export const EVALUATION_QUEUE_UNAVAILABLE = "The evaluation queue isn't available yet.";

/** Shown when POST /api/admin/orders/:id/evaluation is not deployed yet. */
export const EVALUATION_UPLOAD_UNAVAILABLE = "The finished evaluation upload isn't available yet.";

/** The queue route does not 404 for an empty list. A 404 means the route is missing. */
export function evaluationQueueUnavailable(status: number): boolean {
  return status === 404;
}

/**
 * A missing upload route comes back as a generic 404.
 * A real order still reports "Order not found".
 */
export function evaluationUploadError(status: number, error: string): string {
  if (status === 404 && !/order not found/i.test(error)) return EVALUATION_UPLOAD_UNAVAILABLE;
  return error;
}
