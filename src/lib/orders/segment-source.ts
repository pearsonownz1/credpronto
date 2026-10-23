import { sourceTextForDisplay } from "./source-text";

export type StoredSegment = {
  text: string;
  source_index: number;
};

/** Source lines in the same order the admin transcript shows them. */
export function sourceLines(sourceText: string | null): string[] {
  const display = sourceTextForDisplay(sourceText) ?? "";
  const normalized = display.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const STEMS: Array<[RegExp, string]> = [
  [/admis|admitted/, "admit"],
  [/passable|\bpass\b/, "pass"],
  [/session/, "session"],
  [/sous[-\s]?centre|sub[-\s]?cent/, "center"],
  [/jury/, "jury"],
  [/matricule|registration/, "registration"],
  [/baccalaur/, "baccalaureat"],
  [/moyenne|average/, "average"],
  [/francais|french/, "french"],
  [/anglais|english/, "english"],
  [/philosophie|philosophy/, "philosophy"],
  [/mathemat/, "math"],
  [/histoire|geograph|history|geography/, "history"],
  [/education civique|civic/, "civic"],
  [/sciences economiques|economic and legal/, "economics"],
  [/techniques quantitatives|quantitative management/, "quantitative"],
  [/pratique professionnelle|professional practice/, "practice"],
];

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Dates stay whole (`09/09/1979`). Digits, decimals, then words. */
const TOKEN = /\d{1,4}(?:[./-]\d{1,4}){1,2}|\d+(?:[.,]\d+)?|[a-z0-9]+/g;

function tokenWeights(value: string): Map<string, number> {
  const folded = fold(value);
  const words = folded.match(TOKEN) ?? [];
  const weights = new Map<string, number>();
  for (const word of words) {
    if (word.length < 2) continue;
    const weight = /^\d/.test(word) ? (word.length >= 4 ? 6 : 4) : word.length >= 5 ? 2 : 1;
    const previous = weights.get(word) ?? 0;
    if (weight > previous) weights.set(word, weight);
  }
  for (const [pattern, stem] of STEMS) {
    if (!pattern.test(folded)) continue;
    const previous = weights.get(stem) ?? 0;
    if (2 > previous) weights.set(stem, 2);
  }
  return weights;
}

function tokens(value: string): Set<string> {
  return new Set(tokenWeights(value).keys());
}

function overlap(segment: string, line: string): number {
  const left = tokenWeights(segment);
  const right = tokenWeights(line);
  let total = 0;
  for (const [token, weight] of left) {
    if (!right.has(token)) continue;
    total += weight;
  }
  return total;
}

type SourceLine = { line: string; index: number };

/**
 * Order-preserving pass. Several segments may share one printed line when they
 * match it (a split translation). A printed line may also be left unused when
 * its words were folded into a neighboring segment. Blank lines are not in
 * `content`, so a segment is never placed on one. The walk only moves forward.
 */
function assignForward(segments: readonly string[], content: readonly SourceLine[]): number[] {
  const segmentCount = segments.length;
  const lineCount = content.length;
  const floor = Number.NEGATIVE_INFINITY;
  const score: number[][] = Array.from({ length: segmentCount + 1 }, () => Array(lineCount + 1).fill(floor));
  const step: Array<Array<"same" | "next" | "skip" | null>> = Array.from({ length: segmentCount + 1 }, () =>
    Array(lineCount + 1).fill(null),
  );
  score[0][0] = 0;
  for (let lineAt = 1; lineAt <= lineCount; lineAt += 1) {
    score[0]![lineAt] = 0;
    step[0]![lineAt] = "skip";
  }

  for (let segmentAt = 1; segmentAt <= segmentCount; segmentAt += 1) {
    for (let lineAt = 1; lineAt <= lineCount; lineAt += 1) {
      const gain = overlap(segments[segmentAt - 1] ?? "", content[lineAt - 1]?.line ?? "");
      const same = score[segmentAt - 1]?.[lineAt] ?? floor;
      const next = score[segmentAt - 1]?.[lineAt - 1] ?? floor;
      const skip = score[segmentAt]?.[lineAt - 1] ?? floor;
      const choices: Array<{ kind: "next" | "same" | "skip"; value: number }> = [];
      if (next > floor / 2) choices.push({ kind: "next", value: next + gain });
      if (same > floor / 2) choices.push({ kind: "same", value: same + gain });
      if (skip > floor / 2) choices.push({ kind: "skip", value: skip });
      choices.sort((left, right) => right.value - left.value || preference(left.kind) - preference(right.kind));
      const chosen = choices[0];
      if (!chosen) continue;
      score[segmentAt]![lineAt] = chosen.value;
      step[segmentAt]![lineAt] = chosen.kind;
    }
  }

  const assigned = segments.map(() => content[0]?.index ?? 0);
  let segmentAt = segmentCount;
  let lineAt = lineCount;
  while (segmentAt > 0 && lineAt > 0) {
    const kind = step[segmentAt]?.[lineAt];
    if (kind === "skip") {
      lineAt -= 1;
      continue;
    }
    assigned[segmentAt - 1] = content[lineAt - 1]?.index ?? 0;
    segmentAt -= 1;
    if (kind !== "same") lineAt -= 1;
  }
  return assigned;
}

/** On a tie, open a new source line before stacking, and stack before skipping it. */
function preference(kind: "next" | "same" | "skip"): number {
  if (kind === "next") return 0;
  if (kind === "same") return 1;
  return 2;
}

/** One accent-folded stem shared by the segment and the line. A short stem still counts as a full word. */
function stemOverlap(segment: string, line: string): number {
  const foldedSegment = fold(segment);
  const foldedLine = fold(line);
  let total = 0;
  for (const [pattern] of STEMS) {
    if (pattern.test(foldedSegment) && pattern.test(foldedLine)) total += 2;
  }
  return total;
}

/**
 * Best source line by stem score. A single strong stem wins when that line is
 * more specific than any other line with the same score. Equal lines do not move.
 */
function bestStemLine(
  segment: string,
  content: readonly SourceLine[],
): { index: number; score: number; decisive: boolean } {
  const ranked = content
    .map((line) => ({
      index: line.index,
      score: stemOverlap(segment, line.line),
      size: tokens(line.line).size,
    }))
    .sort((left, right) => right.score - left.score || left.size - right.size || left.index - right.index);
  const top = ranked[0];
  const next = ranked[1];
  if (!top || top.score < 2) return { index: top?.index ?? 0, score: top?.score ?? 0, decisive: false };
  const decisive = !next || top.score > next.score || top.size < next.size;
  return { index: top.index, score: top.score, decisive };
}

/**
 * Source line index for each segment. A segment stored out of order is matched
 * to the source line it actually resembles, so several segments can still share
 * one printed line.
 */
export function assignSourceIndexes(sourceText: string | null, segments: readonly string[]): number[] {
  const lines = sourceLines(sourceText);
  const content = lines.flatMap((line, index) => (line.trim() ? [{ line, index }] : []));
  if (segments.length === 0) return [];
  if (content.length === 0) return segments.map(() => 0);

  const forward = assignForward(segments, content);
  return forward.map((sourceIndex, segmentAt) => {
    const segment = segments[segmentAt] ?? "";
    const best = bestStemLine(segment, content);
    const current = stemOverlap(segment, lines[sourceIndex] ?? "");
    if (best.decisive && best.score > current) return best.index;
    return sourceIndex;
  });
}

export function segmentsInSourceOrder(sourceText: string | null, paragraphs: readonly string[]): StoredSegment[] {
  const indexes = assignSourceIndexes(sourceText, paragraphs);
  return paragraphs
    .map((text, index) => ({ text, source_index: indexes[index] ?? 0, index }))
    .sort((a, b) => a.source_index - b.source_index || a.index - b.index)
    .map(({ text, source_index }) => ({ text, source_index }));
}

function storedSegment(value: unknown): StoredSegment | null {
  if (typeof value === "string") return null;
  if (!value || typeof value !== "object") return null;
  const item = value as { text?: unknown; source_index?: unknown };
  const text = typeof item.text === "string" ? item.text : "";
  const sourceIndex = item.source_index;
  if (!text.trim() || typeof sourceIndex !== "number" || !Number.isInteger(sourceIndex) || sourceIndex < 0) return null;
  return { text, source_index: sourceIndex };
}

/** Keeps a stored source_index. Plain strings are aligned, then sorted into source order. */
export function alignTranslation(sourceText: string | null, paragraphs: readonly unknown[]): StoredSegment[] {
  const stored: StoredSegment[] = [];
  const plain: string[] = [];
  let sawPlain = false;
  for (const item of paragraphs) {
    if (typeof item === "string") {
      if (!item.trim()) continue;
      plain.push(item);
      sawPlain = true;
      continue;
    }
    const segment = storedSegment(item);
    if (segment) stored.push(segment);
  }
  if (!sawPlain && stored.length > 0) {
    return [...stored].sort((a, b) => a.source_index - b.source_index);
  }
  return segmentsInSourceOrder(sourceText, plain);
}

export function paragraphTexts(paragraphs: readonly unknown[]): string[] {
  const texts: string[] = [];
  for (const item of paragraphs) {
    if (typeof item === "string") {
      if (item.trim()) texts.push(item);
      continue;
    }
    const segment = storedSegment(item);
    if (segment) texts.push(segment.text);
  }
  return texts;
}
