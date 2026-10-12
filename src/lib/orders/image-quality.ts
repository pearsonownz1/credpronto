import { IMAGE_QUALITY_REASON, MIN_LEGIBILITY } from "./constants";

export { IMAGE_QUALITY_REASON, MIN_LEGIBILITY };

export const QUALITY_FLAGS = ["blurry", "cropped", "glare", "too_dark", "unreadable_fields"] as const;

export type QualityFlag = (typeof QUALITY_FLAGS)[number];

const FLAG_SENTENCE: Record<QualityFlag, string> = {
  blurry: "It looks blurry.",
  cropped: "The page is cropped.",
  glare: "Glare covers the text.",
  too_dark: "It is too dark.",
  unreadable_fields: "Some fields cannot be read.",
};

export function isQualityFlag(value: string): value is QualityFlag {
  return (QUALITY_FLAGS as readonly string[]).includes(value);
}

/**
 * Photos and scans the model actually saw. A missing score is not a failure;
 * transcription problems still use the existing unreadable-page review.
 * Digital text layers are not visual, so a low score there does not hold the quote.
 */
export function failsImageQuality(score: number | null, visual: boolean): boolean {
  if (!visual || score == null || !Number.isFinite(score)) return false;
  return score < MIN_LEGIBILITY;
}

export function retakeMessage(flags: readonly string[]): string {
  const sentences = flags.filter(isQualityFlag).map((flag) => FLAG_SENTENCE[flag]);
  const why = sentences.length > 0 ? sentences.join(" ") : "This photo is hard to read.";
  return `${why} Retake it in even light, with the whole page in the frame and the text sharp, then upload a replacement.`;
}

export function replacementAllowed(order: { status: string; reviewReason: string | null }): boolean {
  return order.status === "needs_review" && order.reviewReason === IMAGE_QUALITY_REASON;
}
