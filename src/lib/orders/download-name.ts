export type DownloadKind = "translation" | "certification" | "original";

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
      : "-certificate.pdf";
  return `${clipStem(base, MAX_FILENAME - suffix.length)}${suffix}`;
}

/**
 * Translation and certification are one PDF for the order.
 * Each source document contributes its own stem, in upload order.
 */
export function orderDownloadFilename(
  kind: "translation" | "certification",
  documentNames: readonly string[],
  targetLanguage = "en",
): string {
  const names = documentNames.length > 0 ? documentNames : [""];
  const combined = names.map((name) => sanitizeStem(splitName(name).stem)).join("-");
  return downloadFilename(kind, `${combined}.pdf`, targetLanguage);
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
