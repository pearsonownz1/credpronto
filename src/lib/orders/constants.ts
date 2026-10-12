export const UNIT_PRICE_CENTS = 995;
export const WORDS_PER_BILLABLE_PAGE = 250;
/** CJK characters on one physical page. A page is 1 billable page until this count is exceeded. */
export const CJK_CHARS_PER_BILLABLE_PAGE = 1000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 15;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const PREVIEW_URL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_SECONDS = 5 * 60;
export const LOW_LANGUAGE_CONFIDENCE = 0.75;
export const SPARSE_PAGE_WORDS = 20;
/** Printed page numbers and continuation cues at or above this score can reorder a document. */
export const ORDER_CONFIDENCE = 0.8;
/** Visual pages below this legibility score are held for a retake. */
export const MIN_LEGIBILITY = 0.6;
export const IMAGE_QUALITY_REASON = "image_quality";
export const DEFAULT_TRANSLATION_MODEL = "google/gemini-3.8-flash";

/** Baked into every page of the watermarked preview. Not drawn on the clean file. */
export const PREVIEW_WATERMARK = "PREVIEW · CREDPRONTO · NOT FOR OFFICIAL USE";
export const PREVIEW_WATERMARK_OPACITY = 0.16;

/** #1F5EFF */
export function previewWatermarkRgb(): { r: number; g: number; b: number } {
  return { r: 0x1f / 255, g: 0x5e / 255, b: 0xff / 255 };
}

export const ORIGINALS_BUCKET = "originals";
export const PREVIEWS_BUCKET = "previews";
export const FINALS_BUCKET = "finals";

export const LETTER_WIDTH_PT = 612;
export const LETTER_HEIGHT_PT = 792;
