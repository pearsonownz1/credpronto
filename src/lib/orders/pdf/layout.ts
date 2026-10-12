import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT, PREVIEW_WATERMARK } from "../constants";

export type TranslationRenderPass = {
  watermark: boolean;
  includeCertification: false;
  bucket: "finals" | "previews";
};

/**
 * Two independent render passes. The preview pass is not a stamp applied to
 * the clean file, and neither pass appends the certification page.
 */
export function translationRenderPasses(): [TranslationRenderPass, TranslationRenderPass] {
  return [
    { watermark: false, includeCertification: false, bucket: "finals" },
    { watermark: true, includeCertification: false, bucket: "previews" },
  ];
}

export type RenderPage = {
  combinedPageNumber: number;
  widthPt: number;
  heightPt: number;
  paragraphs: string[];
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

export function wrapLines(text: string, widthOf: (line: string) => number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && widthOf(next) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export { PREVIEW_WATERMARK };
