import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT, PREVIEW_WATERMARK } from "../constants";

export type TranslationRenderPass = {
  watermark: boolean;
  includeCertification: boolean;
  bucket: "finals" | "previews";
};

/**
 * Two independent render passes. The preview pass is not a stamp applied to
 * the clean file. The clean file starts with the certification cover page.
 */
export function translationRenderPasses(): [TranslationRenderPass, TranslationRenderPass] {
  return [
    { watermark: false, includeCertification: true, bucket: "finals" },
    { watermark: true, includeCertification: false, bucket: "previews" },
  ];
}

export type FieldRow = {
  label: string;
  value: string;
};

export type RenderBlock =
  | { type: "heading"; text: string; level?: 1 | 2 }
  | { type: "paragraph"; text: string }
  | { type: "fields"; rows: FieldRow[] }
  | { type: "seal"; text: string }
  | { type: "signature"; electronic: boolean }
  | { type: "note"; text: string };

export type RenderPage = {
  combinedPageNumber: number;
  widthPt: number;
  heightPt: number;
  paragraphs: string[];
  blocks?: RenderBlock[];
};

export type CoverDocument = {
  name: string;
  sourcePages: number;
  translatedPages: number;
};

export type RenderInput = {
  orderId: string;
  sourceLanguage: string;
  /** ISO date (YYYY-MM-DD) printed on the certification page. */
  date: string;
  pages: RenderPage[];
  targetLanguage?: string | null;
  clientName?: string | null;
  documents?: CoverDocument[];
  /**
   * Detected billable page count stored on the order.
   * The cover prints this as Pages so the certificate matches the receipt.
   */
  pricedPages?: number | null;
  /** Credentials stored on the order. Printed when this translation is bundled with an evaluation. */
  degreeCount?: number | null;
  /** Kept for callers. The cover does not print this name. */
  translatorName?: string | null;
  /** Ignored on the cover. The printed signature is the owner asset. */
  signature?: Uint8Array | null;
};

export function assertContiguousPages(pages: { combinedPageNumber: number }[]): void {
  const numbers = [...pages.map((page) => page.combinedPageNumber)].sort((a, b) => a - b);
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) {
      throw new Error("Translation pages do not match the original page order");
    }
  }
}

export function pageSize(page: { widthPt: number; heightPt: number }): {
  widthPt: number;
  heightPt: number;
} {
  const widthPt = page.widthPt > 0 ? page.widthPt : LETTER_WIDTH_PT;
  const heightPt = page.heightPt > 0 ? page.heightPt : LETTER_HEIGHT_PT;
  return { widthPt, heightPt };
}

function protectedSpans(token: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const match of token.matchAll(/\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d+/g)) {
    const start = match.index ?? 0;
    spans.push([start, start + match[0].length]);
  }
  return spans;
}

function cutsProtected(spans: Array<[number, number]>, index: number): boolean {
  return spans.some(([start, end]) => index > start && index < end);
}

function widestCut(token: string, widthOf: (line: string) => number, maxWidth: number): number {
  let lo = 1;
  let hi = Array.from(token).length - 1;
  let best = 1;
  const chars = Array.from(token);
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (widthOf(chars.slice(0, mid).join("")) <= maxWidth) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function snapOffProtected(token: string, cut: number, widthOf: (line: string) => number, maxWidth: number): number {
  const spans = protectedSpans(token);
  const span = spans.find(([start, end]) => cut > start && cut < end);
  if (!span) return cut;
  const [start, end] = span;
  if (start > 0 && widthOf(token.slice(0, start)) <= maxWidth) return start;
  if (widthOf(token.slice(0, end)) <= maxWidth) return end;
  if (start === 0) return end;
  return start;
}

/**
 * Break a token at punctuation. Dates and digit runs stay whole. A leftover
 * piece with no punctuation (an electronic signature) still breaks by character.
 */
function breakToken(token: string, widthOf: (line: string) => number, maxWidth: number): string[] {
  const spans = protectedSpans(token);
  if (spans.length === 1 && spans[0]?.[0] === 0 && spans[0]?.[1] === token.length) return [token];
  const lines: string[] = [];
  let rest = token;
  while (rest.length > 0) {
    if (widthOf(rest) <= maxWidth) {
      lines.push(rest);
      break;
    }
    const localSpans = protectedSpans(rest);
    let cut = -1;
    const chars = Array.from(rest);
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const before = chars[index - 1] ?? "";
      const after = chars[index] ?? "";
      const boundary = /[^\p{L}\p{N}]/u.test(before) || /[^\p{L}\p{N}]/u.test(after);
      if (!boundary || cutsProtected(localSpans, index)) continue;
      if (widthOf(chars.slice(0, index).join("")) <= maxWidth) {
        cut = index;
        break;
      }
    }
    if (cut <= 0) {
      cut = snapOffProtected(rest, widestCut(rest, widthOf, maxWidth), widthOf, maxWidth);
    }
    if (cut <= 0) cut = 1;
    lines.push(Array.from(rest).slice(0, cut).join(""));
    rest = Array.from(rest).slice(cut).join("");
  }
  return lines;
}

/**
 * Wrap on spaces and punctuation. Dates and numbers stay on one line.
 * A token with no punctuation still breaks so a signature cannot leave the page.
 * Newlines stay as line breaks.
 */
export function wrapLines(text: string, widthOf: (line: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split(/\n/)) {
    const words = rawLine.trim().split(/[ \t]+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = "";
    const flush = () => {
      if (!current) return;
      lines.push(current);
      current = "";
    };
    for (const word of words) {
      if (widthOf(word) > maxWidth) {
        flush();
        lines.push(...breakToken(word, widthOf, maxWidth));
        continue;
      }
      const next = current ? `${current} ${word}` : word;
      if (current && widthOf(next) > maxWidth) {
        flush();
        current = word;
      } else {
        current = next;
      }
    }
    flush();
  }
  return lines;
}

export { PREVIEW_WATERMARK };
