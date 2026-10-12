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
