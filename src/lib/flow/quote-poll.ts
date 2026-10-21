/** How often the quote screen asks for the order while files are still being read. */
export const QUOTE_POLL_MS = 4_000;

/** Give up on a draft read and show a retry instead of leaving the bar stuck. */
export const QUOTE_READ_TIMEOUT_MS = 3 * 60 * 1000;

/** One in-flight GET should not block the timeout check. */
export const QUOTE_REQUEST_TIMEOUT_MS = 15_000;

export const QUOTE_READ_TIMEOUT_MESSAGE =
  "Reading your files is taking longer than expected. Try again in a moment.";

const WORKING = new Set(["draft", "confirmed", "processing", "correction_requested"]);

export type QuotePollOrder = {
  status: string;
  progress?: { step?: string | null } | null;
};

/** The reading screen should leave once analysis finished, including `progress.step === "done"`. */
export function quoteReadFinished(
  order: { status?: string | null; progress?: { step?: string | null } | null } | null | undefined,
): boolean {
  if (!order?.status) return false;
  if (order.status === "draft") return order.progress?.step === "done";
  return true;
}

/**
 * Next delay while the quote can still change.
 * A draft whose pages are all read (the 60% plateau) stays open.
 * `done` closes it even if `status` has not left `draft` yet.
 */
export function quotePollDelay(order: QuotePollOrder): number | null {
  if (order.status === "draft" && order.progress?.step === "done") return null;
  if (order.status === "draft" || WORKING.has(order.status)) return QUOTE_POLL_MS;
  return null;
}

/** Still waiting on the first quote, not a later preview or download poll. */
export function quoteReadPending(order: QuotePollOrder | null): boolean {
  if (!order) return true;
  if (order.progress?.step === "done") return false;
  return order.status === "draft";
}

export function quoteReadTimedOut(order: QuotePollOrder | null, elapsedMs: number): boolean {
  return elapsedMs >= QUOTE_READ_TIMEOUT_MS && quoteReadPending(order);
}

export type QuotePollSettlement<T extends QuotePollOrder> =
  | { kind: "order"; order: T; done: boolean }
  | { kind: "retry" }
  | { kind: "error"; message: string };

/**
 * One poll result. A draft read is never "done" after the first response.
 * Fatal HTTP statuses stop immediately. Other failures keep the loop alive
 * until the read timeout.
 */
export function settleQuotePoll<T extends QuotePollOrder>(input: {
  order: T | null;
  elapsedMs: number;
  error: { status: number; message: string } | null;
}): QuotePollSettlement<T> {
  if (input.error) {
    if (input.error.status === 404 || input.error.status === 410) {
      const message = input.error.message.trim();
      return { kind: "error", message: message || "Could not load this order" };
    }
    if (quoteReadTimedOut(input.order, input.elapsedMs)) {
      return { kind: "error", message: QUOTE_READ_TIMEOUT_MESSAGE };
    }
    return { kind: "retry" };
  }

  if (!input.order) {
    if (quoteReadTimedOut(null, input.elapsedMs)) {
      return { kind: "error", message: QUOTE_READ_TIMEOUT_MESSAGE };
    }
    return { kind: "retry" };
  }

  const done = quotePollDelay(input.order) == null;
  if (!done && quoteReadTimedOut(input.order, input.elapsedMs)) {
    return { kind: "error", message: QUOTE_READ_TIMEOUT_MESSAGE };
  }
  return { kind: "order", order: input.order, done };
}
