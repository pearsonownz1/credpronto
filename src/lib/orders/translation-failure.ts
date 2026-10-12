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

export function isTemporaryTranslationError(error: unknown): boolean {
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
