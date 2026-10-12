export const UNIT_PRICE_CENTS = 995;
export const WORDS_PER_BILLABLE_PAGE = 250;
export const CJK_UNITS_PER_BILLABLE_PAGE = 400;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 15;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const PREVIEW_URL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_SECONDS = 5 * 60;
export const LOW_LANGUAGE_CONFIDENCE = 0.75;
export const SPARSE_PAGE_WORDS = 20;
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
