import { IMAGE_QUALITY_REASON, MIN_LEGIBILITY } from "./constants";
import { countWords } from "./words";

export { IMAGE_QUALITY_REASON, MIN_LEGIBILITY };

export const QUALITY_FLAGS = ["blurry", "cropped", "glare", "too_dark", "unreadable_fields"] as const;

export type QualityFlag = (typeof QUALITY_FLAGS)[number];

/** Soft severe flags the model often sets on readable phone photos of handwritten forms. */
const CONSERVATIVE_FLAGS = new Set<QualityFlag>(["blurry", "too_dark", "unreadable_fields"]);

/** Enough transcribed text that a conservative soft flag should not hold the quote. */
export const READABLE_TEXT_CHARS = 80;
export const READABLE_TEXT_WORDS = 15;
export const READABLE_LEGIBILITY = 0.35;

const FLAG_SENTENCE: Record<QualityFlag, string> = {
  blurry: "It looks blurry.",
  cropped: "The crop cuts off the text.",
  glare: "Glare covers the text.",
  too_dark: "It is too dark.",
  unreadable_fields: "Some fields cannot be read.",
};

export function isQualityFlag(value: string): value is QualityFlag {
  return (QUALITY_FLAGS as readonly string[]).includes(value);
}

/**
 * Flags that hold a quote no matter how high the model scored the photo.
 * `cropped` counts only when the crop cuts off text; the model is told to set
 * that flag only in that case. Glare alone does not.
 */
const SEVERE_FLAGS = new Set<QualityFlag>(["blurry", "too_dark", "unreadable_fields", "cropped"]);

export function isSevereQualityFlag(value: string): boolean {
  return isQualityFlag(value) && SEVERE_FLAGS.has(value);
}

export type QualityEvidence = {
  text?: string | null;
  words?: number | null;
};

/** Phone photos of stamped/handwritten certificates often still yield a usable transcription. */
export function hasReadablePhotoText(
  score: number | null,
  evidence: QualityEvidence | undefined,
): boolean {
  if (score == null || !Number.isFinite(score) || score < READABLE_LEGIBILITY) return false;
  const text = (evidence?.text ?? "").trim();
  const words = evidence?.words != null && Number.isFinite(evidence.words) ? evidence.words : countWords(text);
  return text.length >= READABLE_TEXT_CHARS && words >= READABLE_TEXT_WORDS;
}

/** Severe flags that still hold the quote after readable-photo overrides. */
export function holdingQualityFlags(
  flags: readonly string[],
  score: number | null,
  evidence?: QualityEvidence,
): QualityFlag[] {
  const qualityFlags = flags.filter(isQualityFlag);
  const readable = hasReadablePhotoText(score, evidence);
  return qualityFlags.filter((flag) => {
    if (!SEVERE_FLAGS.has(flag)) return false;
    if (readable && CONSERVATIVE_FLAGS.has(flag)) return false;
    return true;
  });
}

/**
 * Photos and scans the model actually saw. A severe flag overrides a high
 * score. A missing score with no severe flag is not a failure; transcription
 * problems still use the existing unreadable-page review. Digital text layers
 * are not visual, so a low score there does not hold the quote.
 * Readable phone photos with substantial OCR text are not failed for soft
 * `too_dark` / `blurry` / `unreadable_fields` tags alone.
 */
export function failsImageQuality(
  score: number | null,
  visual: boolean,
  flags: readonly string[] = [],
  evidence?: QualityEvidence,
): boolean {
  if (!visual) return false;
  if (holdingQualityFlags(flags, score, evidence).length > 0) return true;
  if (score == null || !Number.isFinite(score)) return false;
  if (hasReadablePhotoText(score, evidence)) return false;
  return score < MIN_LEGIBILITY;
}

/** A severe flag means the model's score is not usable, even when it is high. */
export function trustedLegibility(
  score: number | null,
  flags: readonly string[],
  evidence?: QualityEvidence,
): number | null {
  if (holdingQualityFlags(flags, score, evidence).length === 0) return score;
  const cap = Math.round((MIN_LEGIBILITY - 0.01) * 100) / 100;
  if (score == null || !Number.isFinite(score)) return cap;
  return Math.min(score, cap);
}

/** Retake copy for a flagged page. A failing score with no flags still gets instructions. */
export function pageQuality(input: {
  score: number | null;
  visual: boolean;
  flags: readonly string[];
  text?: string | null;
  words?: number | null;
}): { failed: boolean; score: number | null; message: string | null } {
  const flags = input.flags.filter(isQualityFlag);
  const evidence = { text: input.text, words: input.words };
  const failed = failsImageQuality(input.score, input.visual, flags, evidence);
  const shownFlags = failed ? holdingQualityFlags(flags, input.score, evidence) : flags;
  const message = shownFlags.length > 0 || failed ? retakeMessage(failed ? shownFlags : flags) : null;
  return { failed, score: trustedLegibility(input.score, flags, evidence), message };
}

export function retakeMessage(flags: readonly string[]): string {
  const sentences = flags.filter(isQualityFlag).map((flag) => FLAG_SENTENCE[flag]);
  const why = sentences.length > 0 ? sentences.join(" ") : "This photo is hard to read.";
  return `${why} Retake it in even light, with the whole page in the frame and the text sharp, then upload a replacement.`;
}

export function replacementAllowed(order: { status: string; reviewReason: string | null }): boolean {
  return order.status === "needs_review" && order.reviewReason === IMAGE_QUALITY_REASON;
}
