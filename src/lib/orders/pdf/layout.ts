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

export type RenderInput = {
  orderId: string;
  sourceLanguage: string;
  /** ISO date (YYYY-MM-DD) printed on the certification page. */
  date: string;
  pages: RenderPage[];
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

function breakToken(token: string, widthOf: (line: string) => number, maxWidth: number): string[] {
  const chars = Array.from(token);
  const lines: string[] = [];
  let start = 0;
  while (start < chars.length) {
    const rest = chars.slice(start).join("");
    if (widthOf(rest) <= maxWidth) {
      lines.push(rest);
      break;
    }
    let lo = start + 1;
    let hi = chars.length - 1;
    let best = start + 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (widthOf(chars.slice(start, mid).join("")) <= maxWidth) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    lines.push(chars.slice(start, best).join(""));
    start = best;
  }
  return lines;
}

/**
 * Wrap on spaces, and break a token anywhere once it is wider than the line
 * (the same rule as CSS overflow-wrap: anywhere). Newlines stay as line breaks.
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
