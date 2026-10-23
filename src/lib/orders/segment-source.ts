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

function tokens(value: string): Set<string> {
  const folded = fold(value);
  const words = folded.match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? [];
  const set = new Set(words.filter((word) => word.length >= 2));
  for (const [pattern, stem] of STEMS) {
    if (pattern.test(folded)) set.add(stem);
  }
  return set;
}

function overlap(segment: string, line: string): number {
  const left = tokens(segment);
  const right = tokens(line);
  let total = 0;
  for (const token of left) {
    if (!right.has(token)) continue;
    total += /^\d/.test(token) ? 4 : token.length >= 5 ? 2 : 1;
  }
  return total;
}

type SourceLine = { line: string; index: number };

/**
 * Order-preserving pass. Several segments may share one printed line, and the
 * walk only moves forward, so a segment stored before its source line cannot
 * reach that line.
 */
function assignForward(segments: readonly string[], content: readonly SourceLine[]): number[] {
  const segmentCount = segments.length;
  const lineCount = content.length;
  const floor = Number.NEGATIVE_INFINITY;
  const score: number[][] = Array.from({ length: segmentCount + 1 }, () => Array(lineCount + 1).fill(floor));
  const step: Array<Array<"same" | "next" | null>> = Array.from({ length: segmentCount + 1 }, () =>
    Array(lineCount + 1).fill(null),
  );
  score[0][0] = 0;

  for (let segmentAt = 1; segmentAt <= segmentCount; segmentAt += 1) {
    for (let lineAt = 1; lineAt <= lineCount; lineAt += 1) {
      const gain = overlap(segments[segmentAt - 1] ?? "", content[lineAt - 1]?.line ?? "");
      const same = score[segmentAt - 1]?.[lineAt] ?? floor;
      const next = score[segmentAt - 1]?.[lineAt - 1] ?? floor;
      if (next >= same && next > floor / 2) {
        score[segmentAt]![lineAt] = next + gain;
        step[segmentAt]![lineAt] = "next";
      } else if (same > floor / 2) {
        score[segmentAt]![lineAt] = same + gain;
        step[segmentAt]![lineAt] = "same";
      }
    }
  }

  let lineAt = 1;
  if (segmentCount >= lineCount && (score[segmentCount]?.[lineCount] ?? floor) > floor / 2) {
    lineAt = lineCount;
  } else {
    let best = floor;
    for (let column = 1; column <= lineCount; column += 1) {
      const value = score[segmentCount]?.[column] ?? floor;
      if (value > best) {
        best = value;
        lineAt = column;
      }
    }
  }

  const assigned = segments.map(() => content[0]?.index ?? 0);
  let segmentAt = segmentCount;
  while (segmentAt > 0 && lineAt > 0) {
    assigned[segmentAt - 1] = content[lineAt - 1]?.index ?? 0;
    if (step[segmentAt]?.[lineAt] === "same") segmentAt -= 1;
    else {
      segmentAt -= 1;
      lineAt -= 1;
    }
  }
  return assigned;
}

function bestSourceLine(
  segment: string,
  content: readonly SourceLine[],
): { index: number; score: number; second: number } {
  let index = content[0]?.index ?? 0;
  let score = -1;
  let second = -1;
  for (const line of content) {
    const value = overlap(segment, line.line);
    if (value > score) {
      second = score;
      score = value;
      index = line.index;
    } else if (value > second) {
      second = value;
    }
  }
  return { index, score, second };
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
    const best = bestSourceLine(segment, content);
    const current = overlap(segment, lines[sourceIndex] ?? "");
    if (best.score >= 2 && best.score > current && best.score > best.second) return best.index;
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
