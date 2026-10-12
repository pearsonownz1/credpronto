import { AiUnavailableError } from "./errors";

export const TRANSLATION_TIMEOUT_REASON = "translation_timeout";
/** One translateDocument call, including its single retry, stays under this. */
export const TRANSLATION_DEADLINE_MS = 300_000;
/**
 * One billable page runs in its own function (`maxDuration` 300).
 * Stop about 45 seconds early so a failed attempt can be saved before the platform kills the function.
 */
export const TRANSLATION_PAGE_DEADLINE_MS = 255_000;

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
  const reviewReason = input.error instanceof Error ? input.error.message : "Translation failed.";
  if (input.readyPreview && input.openCorrections) {
    return { status: "preview_ready", reviewReason, notifyFailed: false };
  }
  return { status: "failed", reviewReason, notifyFailed: true };
}
