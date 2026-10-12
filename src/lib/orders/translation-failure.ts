import { AiUnavailableError } from "./errors";
import { humanReviewReason } from "./review-reason";

export const TRANSLATION_TIMEOUT_REASON = "translation_timeout";
/** Route segment `maxDuration` in seconds for the translation routes. */
export const TRANSLATION_MAX_DURATION_SEC = 300;
/**
 * Reserved after the model abort so status and review_reason are written
 * before the platform kills the isolate at maxDuration.
 */
export const TRANSLATION_SHUTDOWN_MS = 45_000;
/** One translateDocument call, including its single retry, stays under this. */
export const TRANSLATION_DEADLINE_MS = TRANSLATION_MAX_DURATION_SEC * 1000 - TRANSLATION_SHUTDOWN_MS;
/**
 * One billable page uses the same budget so the invocation can record a failure
 * before the platform kills the function at maxDuration.
 */
export const TRANSLATION_PAGE_DEADLINE_MS = TRANSLATION_DEADLINE_MS;

const PAID_OR_RELEASED = new Set(["paid", "approved", "delivered"]);

/**
 * A failed translation can be started over. Paid orders and released
 * certifications (approved or delivered) stay where they are.
 */
export function canRetryFailedTranslation(order: {
  status: string;
  reviewReason: string | null;
  languageConfirmed: boolean;
}): boolean {
  if (PAID_OR_RELEASED.has(order.status)) return false;
  if (order.status !== "failed" || !order.languageConfirmed) return false;
  return /translation/i.test(order.reviewReason?.trim() ?? "");
}

function errorChain(error: unknown): string {
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) return "";
  const cause = error.cause == null ? "" : ` ${errorChain(error.cause)}`;
  return `${error.name} ${error.message}${cause}`;
}

/** Gemini sometimes returns a seal-heavy page as text the SDK cannot parse. */
export function isUnreadableModelOutput(error: unknown): boolean {
  const text = errorChain(error);
  return /NoObjectGenerated|no object generated|could not parse the response|json parsing failed/i.test(text);
}

export function isTemporaryTranslationError(error: unknown): boolean {
  if (isUnreadableModelOutput(error)) return true;
  if (error instanceof AiUnavailableError) return true;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  const message = error instanceof Error ? error.message : "";
  return /timeout|aborted/i.test(message);
}

export type TranslationFailure = {
  status: "needs_review" | "preview_ready" | "correction_requested" | "failed";
  reviewReason: string;
  notifyFailed: boolean;
};

/**
 * A timeout stays in review and does not emit order.failed.
 * Any other error during a correction keeps the previous ready preview.
 */
export function decideTranslationFailure(input: {
  error: unknown;
  readyPreview: boolean;
  openCorrections: boolean;
}): TranslationFailure {
  if (isTemporaryTranslationError(input.error)) {
    return {
      status: "needs_review",
      reviewReason: TRANSLATION_TIMEOUT_REASON,
      notifyFailed: false,
    };
  }
  const raw = input.error instanceof Error ? input.error.message : "Translation failed.";
  const reviewReason = humanReviewReason(raw) ?? "Translation failed.";
  if (input.readyPreview && input.openCorrections) {
    return { status: "preview_ready", reviewReason, notifyFailed: false };
  }
  return { status: "failed", reviewReason, notifyFailed: true };
}

function deadlineRejection(deadline: AbortSignal): Promise<never> {
  if (deadline.aborted) return Promise.reject(new AiUnavailableError("translation_timeout"));
  return new Promise((_, reject) => {
    deadline.addEventListener("abort", () => reject(new AiUnavailableError("translation_timeout")), { once: true });
  });
}

/**
 * First of the translation work or the deadline. The loser is ignored so a
 * layout pass that keeps running cannot become an unhandled rejection, and
 * the caller can still write status and review_reason.
 */
export function raceWorkAgainstDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      settle();
    };
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
    deadlineRejection(deadline).then(
      () => finish(() => reject(new AiUnavailableError("translation_timeout"))),
      (error) => finish(() => reject(error)),
    );
  });
}
