import { SPARSE_PAGE_WORDS } from "./constants";
import { countWords } from "./words";

const VOWEL = /[aeiouáéíóúàèìòùâêîôûäëïöüãõyæø]/i;
const CLUSTER = /[bcdfghjklmnpqrstvwxzçñ]{5,}/i;

/**
 * A dense embedded PDF text layer that is still not safe to trust.
 * Scanned transcripts often ship a garbled OCR layer ("sflfnetda", "1112000")
 * with enough tokens to look like real text. Those pages need vision OCR.
 */
export function isGarbledEmbeddedText(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (countWords(trimmed) < SPARSE_PAGE_WORDS) return false;
  const letters = trimmed.match(/\p{L}/gu) ?? [];
  if (letters.length < 40) return false;
  const latin = letters.filter((letter) => /\p{Script=Latin}/u.test(letter)).length;
  if (latin / letters.length < 0.75) return false;
  const words = trimmed.match(/\p{Script=Latin}{2,}/gu) ?? [];
  if (words.length < 12) return false;
  const broken = words.filter((word) => (word.length >= 4 && !VOWEL.test(word)) || CLUSTER.test(word));
  const longDigits = trimmed.match(/\d{7,}/g) ?? [];
  const gluedYears = longDigits.filter((run) => /(?:19|20)\d{2}$/.test(run));
  const slashDates = trimmed.match(/\d{1,2}\s*\/\s*\d{2,4}/g) ?? [];
  if (broken.length >= 4 && broken.length / words.length >= 0.12) return true;
  if (gluedYears.length >= 3 && slashDates.length <= 1) return true;
  if (gluedYears.length >= 2 && broken.length >= 2 && slashDates.length === 0) return true;
  return false;
}

/** Sparse pages and garbled embedded layers both need a vision read. */
export function pageNeedsVisionOcr(text: string): boolean {
  return countWords(text) < SPARSE_PAGE_WORDS || isGarbledEmbeddedText(text);
}
