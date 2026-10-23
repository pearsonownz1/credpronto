import { sourceTextForDisplay } from "@/lib/orders/source-text";

export type TranslationLine = {
  source: string;
  translation: string;
  /** Index into the stored segments. Null on a blank source line, which does not consume a segment. */
  segmentIndex: number | null;
};

export type TranslationAlignment = {
  rows: TranslationLine[];
  /** Non-blank source lines that have no stored segment. */
  missing: number;
  /** Stored segments that have no non-blank source line. */
  extra: number;
};

/**
 * Pair segment k with the k-th non-blank source line.
 * Blank lines stay blank on both sides and do not consume a segment.
 * Segments are already stored with blanks removed, one per non-blank line.
 */
export function translationLines(sourceText: string | null, segments: readonly string[]): TranslationAlignment {
  const display = sourceTextForDisplay(sourceText);
  const normalized = (display ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const rows: TranslationLine[] = [];
  let segmentCursor = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      rows.push({ source: "", translation: "", segmentIndex: null });
      continue;
    }
    const segmentIndex = segmentCursor;
    segmentCursor += 1;
    rows.push({
      source: line,
      translation: segmentIndex < segments.length ? (segments[segmentIndex] ?? "") : "",
      segmentIndex,
    });
  }

  const nonBlank = segmentCursor;
  const extra = Math.max(0, segments.length - nonBlank);
  const missing = Math.max(0, nonBlank - segments.length);
  for (let offset = 0; offset < extra; offset += 1) {
    const segmentIndex = nonBlank + offset;
    rows.push({
      source: "",
      translation: segments[segmentIndex] ?? "",
      segmentIndex,
    });
  }

  return { rows, extra, missing };
}

export function segmentMismatchWarning(alignment: Pick<TranslationAlignment, "extra" | "missing">): string | null {
  if (alignment.extra > 0) {
    const noun = alignment.extra === 1 ? "segment" : "segments";
    return `Translation has ${alignment.extra} extra ${noun} not matched to the source`;
  }
  if (alignment.missing > 0) {
    const noun = alignment.missing === 1 ? "segment" : "segments";
    return `Translation is missing ${alignment.missing} ${noun} for the source`;
  }
  return null;
}
