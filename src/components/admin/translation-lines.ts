import { sourceTextForDisplay } from "@/lib/orders/source-text";

export type TranslationLine = {
  source: string;
  translation: string;
  /** Index into the stored segments. Null when the source line is blank. */
  segmentIndex: number | null;
};

/**
 * Pair each source line with the stored segment at the same index.
 * A blank source line stays blank on both sides.
 * Segments past the last source line are omitted.
 * A missing segment leaves the translation cell blank.
 */
export function translationLines(sourceText: string | null, segments: readonly string[]): TranslationLine[] {
  const display = sourceTextForDisplay(sourceText);
  if (!display) return [];
  const normalized = display.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  return lines.map((line, index) => {
    if (line.trim().length === 0) {
      return { source: "", translation: "", segmentIndex: null };
    }
    return {
      source: line,
      translation: index < segments.length ? (segments[index] ?? "") : "",
      segmentIndex: index,
    };
  });
}
