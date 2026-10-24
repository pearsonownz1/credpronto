import { coveredSourceIndexes } from "@/lib/orders/segment-source";
import { sourceTextForDisplay } from "@/lib/orders/source-text";

export type TranslationLine = {
  source: string;
  translation: string;
  /** Index into the stored segments. Null on a blank source line, which does not consume a segment. */
  segmentIndex: number | null;
};

export type TranslationAlignment = {
  rows: TranslationLine[];
  /** Non-blank source lines with no segment and not covered by the previous segment's run. */
  missing: number;
  /** Stored segments that have no non-blank source line. */
  extra: number;
};

type SegmentSlot = { text: string; segmentIndex: number };

/**
 * Pair each segment with the non-blank source line whose index equals that
 * segment's source_index. Several segments may share one line.
 * A segment whose source_index is absent falls back to positional pairing:
 * segment k goes with the k-th non-blank source line.
 * A source_index that does not point at a non-blank line stays unmatched.
 * Blank source lines stay blank on both sides. A non-blank line with no
 * segment stays read-only. It counts as missing unless it continues the
 * previous segment's run (a title line, then the name).
 */
export function translationLines(
  sourceText: string | null,
  segments: readonly string[],
  sourceIndexes?: readonly number[] | null,
): TranslationAlignment {
  const display = sourceTextForDisplay(sourceText);
  const normalized = (display ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (sourceIndexes != null) return translationLinesByIndex(lines, segments, sourceIndexes);
  return translationLinesByPosition(lines, segments);
}

function translationLinesByPosition(lines: readonly string[], segments: readonly string[]): TranslationAlignment {
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

/** Undefined when this segment has no source_index. A number, even if unusable, is present. */
function sourceIndexAt(sourceIndexes: readonly number[], segmentIndex: number): number | undefined {
  if (segmentIndex < 0 || segmentIndex >= sourceIndexes.length) return undefined;
  if (!Object.prototype.hasOwnProperty.call(sourceIndexes, segmentIndex)) return undefined;
  const value = sourceIndexes[segmentIndex] as number | null | undefined;
  if (value == null || typeof value !== "number") return undefined;
  return value;
}

function translationLinesByIndex(
  lines: readonly string[],
  segments: readonly string[],
  sourceIndexes: readonly number[],
): TranslationAlignment {
  const nonBlank = lines.flatMap((line, index) => (line.trim().length === 0 ? [] : [index]));
  const covered = new Set(coveredSourceIndexes(lines.join("\n"), segments, sourceIndexes));
  const groups = new Map<number, SegmentSlot[]>();
  const unmatched: SegmentSlot[] = [];

  const place = (lineIndex: number, slot: SegmentSlot) => {
    const group = groups.get(lineIndex) ?? [];
    group.push(slot);
    groups.set(lineIndex, group);
  };

  segments.forEach((text, segmentIndex) => {
    const slot = { text, segmentIndex };
    const sourceIndex = sourceIndexAt(sourceIndexes, segmentIndex);
    if (sourceIndex === undefined) {
      const lineIndex = nonBlank[segmentIndex];
      if (lineIndex == null) unmatched.push(slot);
      else place(lineIndex, slot);
      return;
    }
    const line = Number.isInteger(sourceIndex) && sourceIndex >= 0 ? lines[sourceIndex] : undefined;
    if (line == null || line.trim().length === 0) {
      unmatched.push(slot);
      return;
    }
    place(sourceIndex, slot);
  });

  for (const group of groups.values()) group.sort((left, right) => left.segmentIndex - right.segmentIndex);

  const rows: TranslationLine[] = [];
  let missing = 0;
  lines.forEach((line, index) => {
    if (line.trim().length === 0) {
      rows.push({ source: "", translation: "", segmentIndex: null });
      return;
    }
    const matched = groups.get(index) ?? [];
    if (matched.length === 0) {
      if (!covered.has(index)) missing += 1;
      rows.push({ source: line, translation: "", segmentIndex: null });
      return;
    }
    matched.forEach((segment, offset) => {
      rows.push({
        source: offset === 0 ? line : "",
        translation: segment.text,
        segmentIndex: segment.segmentIndex,
      });
    });
  });

  for (const segment of unmatched) {
    rows.push({ source: "", translation: segment.text, segmentIndex: segment.segmentIndex });
  }
  return { rows, extra: unmatched.length, missing };
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
