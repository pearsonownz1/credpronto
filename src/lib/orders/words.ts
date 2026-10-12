const CJK =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;

/** Whitespace-delimited words, with each CJK character counted as one word. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const cjk = trimmed.match(CJK);
  const rest = trimmed.replace(CJK, " ");
  const words = rest.split(/\s+/).filter(Boolean);
  return words.length + (cjk?.length ?? 0);
}

const NON_CJK_WORD = /[\p{L}\p{N}]+/gu;

/**
 * Deterministic script check used when AI language detection is unavailable.
 * True when CJK characters outnumber the other letter/number words, so a
 * Chinese page with a Latin banner or digits still counts as CJK.
 */
export function isCjkDominant(text: string): boolean {
  const cjk = text.match(CJK)?.length ?? 0;
  if (cjk === 0) return false;
  const others = text.replace(CJK, " ").match(NON_CJK_WORD)?.length ?? 0;
  return cjk > others;
}
