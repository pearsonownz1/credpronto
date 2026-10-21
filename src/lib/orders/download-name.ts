import { documentHeading } from "./pdf/structure";

export type DownloadKind = "translation" | "certification" | "evaluation" | "original";

const CERTIFIED_TRANSLATION_SUFFIX = "-certified-translation.pdf";

const FALLBACK_STEM = "document";
const MAX_FILENAME = 120;

/**
 * Download names are safe ASCII so Content-Disposition can carry them.
 * The stem is the source document name without its extension.
 * An empty stem becomes `document`. A sample name is never substituted.
 */
export function downloadFilename(
  kind: DownloadKind,
  documentName: string,
  targetLanguage = "en",
): string {
  const { stem, extension } = splitName(documentName);
  const base = sanitizeStem(stem);
  if (kind === "original") {
    return clip(`${base}${sanitizeExtension(extension)}`);
  }
  const suffix =
    kind === "translation"
      ? `-${targetLanguageCode(targetLanguage)}-certified.pdf`
      : kind === "evaluation"
        ? "-evaluation.pdf"
        : "-certificate.pdf";
  return `${clipStem(base, MAX_FILENAME - suffix.length)}${suffix}`;
}

/**
 * Translation and certification are one PDF for the order.
 * Each source document contributes its own stem, in upload order.
 */
export function orderDownloadFilename(
  kind: "translation" | "certification" | "evaluation",
  documentNames: readonly string[],
  targetLanguage = "en",
): string {
  const names = documentNames.length > 0 ? documentNames : [""];
  const combined = names.map((name) => sanitizeStem(splitName(name).stem)).join("-");
  return downloadFilename(kind, `${combined}.pdf`, targetLanguage);
}

/**
 * Customer filename for the single certified packet.
 * A detected title is slugified (`Tax status letter` → `Tax-status-letter`).
 * Without one, the upload base name is kept (`birth-certificate`).
 */
export function deliveryDocumentName(input: {
  detectedTitle?: string | null;
  documentNames: readonly string[];
}): { title: string; filename: string } {
  const detected = input.detectedTitle?.replace(/\s+/g, " ").trim() || null;
  const fallbackStem = uploadBaseStem(input.documentNames);
  const title = detected || humanizeStem(fallbackStem);
  const base = detected ? slugifyDocumentTitle(detected) : fallbackStem;
  const stem = clipStem(base || FALLBACK_STEM, MAX_FILENAME - CERTIFIED_TRANSLATION_SUFFIX.length);
  return { title, filename: `${stem}${CERTIFIED_TRANSLATION_SUFFIX}` };
}

/** `Tax status letter` becomes `Tax-status-letter`. */
export function slugifyDocumentTitle(value: string): string {
  const words = stripMarks(value)
    .replace(/['’]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (words.length === 0) return "";
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join("-");
}

/**
 * Prefer a translated heading, then a known source title, then nothing.
 * Callers fall back to the upload base name.
 */
export function detectDocumentTitle(input: {
  outputs?: readonly unknown[];
  ocrTexts?: readonly (string | null | undefined)[];
}): string | null {
  for (const output of input.outputs ?? []) {
    const heading = headingFromTranslation(output);
    if (heading) return heading;
  }
  for (const text of input.ocrTexts ?? []) {
    if (!text) continue;
    const heading = documentHeading(text);
    if (heading) return heading;
  }
  return null;
}

function headingFromTranslation(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const pages = (output as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return null;
  let secondary: string | null = null;
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    const blocks = (page as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const typed = block as { type?: unknown; text?: unknown; level?: unknown };
      if (typed.type !== "heading" || typeof typed.text !== "string") continue;
      const text = typed.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (typed.level !== 2) return text;
      if (!secondary) secondary = text;
    }
  }
  return secondary;
}

function uploadBaseStem(documentNames: readonly string[]): string {
  const names = documentNames.length > 0 ? documentNames : [""];
  return names.map((name) => sanitizeStem(splitName(name).stem)).join("-");
}

function humanizeStem(stem: string): string {
  const words = stem.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) return "Document";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

export function targetLanguageCode(targetLanguage: string | null | undefined): string {
  const primary = (targetLanguage ?? "").trim().split(/[-_\s]/)[0] ?? "";
  const letters = stripMarks(primary).replace(/[^A-Za-z]/g, "");
  return (letters.slice(0, 8) || "en").toUpperCase();
}

function splitName(filename: string): { stem: string; extension: string } {
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "";
  const match = /^(.*?)(\.[A-Za-z0-9]{1,10})$/.exec(base);
  if (!match) return { stem: base, extension: "" };
  return { stem: match[1] ?? "", extension: match[2] ?? "" };
}

function sanitizeStem(value: string): string {
  const cleaned = stripMarks(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned || FALLBACK_STEM;
}

function sanitizeExtension(extension: string): string {
  const match = /^\.([A-Za-z0-9]{1,10})$/.exec(extension);
  return match ? `.${match[1]}` : "";
}

function stripMarks(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function clipStem(stem: string, max: number): string {
  const room = Math.max(1, max);
  const cut = stem.slice(0, room).replace(/[._-]+$/g, "");
  return cut || FALLBACK_STEM;
}

function clip(filename: string): string {
  if (filename.length <= MAX_FILENAME) return filename;
  const { stem, extension } = splitName(filename);
  return `${clipStem(stem, MAX_FILENAME - extension.length)}${extension}`;
}
