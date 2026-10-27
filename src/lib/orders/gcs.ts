import { HttpError } from "./errors";
import { isSupportedSourceLanguage, normalizeLanguage } from "./languages";

export const GCS_BRAND = "gcs" as const;

/** One GCS translation can combine this many PDFs or images. */
export const GCS_MAX_DOCUMENTS = 10;

export type OrderBrand = "credpronto" | typeof GCS_BRAND;

/** Printed on the certificate when the document has no client name. */
export const GCS_CLIENT_FALLBACK = "Client";

export const GCS_CERTIFICATION_STATEMENTS = [
  "As an authorized representative of GEO Credential Services, a professional translation services agency, I hereby certify that the above-mentioned document has been translated by an experienced, qualified and competent professional translator, fluent in the above-mentioned language pair and that, in my best judgment, the translated text truly reflects the content, meaning, and style of the original text and constitutes in every respect a complete and accurate translation of the original document. This document has not been translated for a family member, friend, or business associate.",
  "This is to certify the correctness of the translation only. I do not make any claims or guarantees about the authenticity or content of the original document. Further, GEO Credential Services assumes no liability for the way in which the translation is used by the customer or any third party, including end-users of the translation.",
] as const;

export const GCS_SIGNER = "Staffan Moritz";
export const GCS_ORG = "GEO Credential Services";
export const GCS_STREET = "1489 W. Palmetto Park Road";
export const GCS_SUITE = "Suite 500";
export const GCS_LOCALITY = "Boca Raton, FL";
export const GCS_FOOTER = `${GCS_ORG} · gcs.org · ${GCS_STREET}, ${GCS_SUITE}, ${GCS_LOCALITY}`;
export const GCS_CONTACT = "support@gcs.org | www.gcs.org";

export function isGcsBrand(value: string | null | undefined): boolean {
  return value === GCS_BRAND;
}

export function isGcsOrder(order: { brand?: string | null } | null | undefined): boolean {
  return isGcsBrand(order?.brand);
}

/**
 * Language a GCS order can translate with. A chosen language wins, then the
 * detected language, then the first detected file language. `"auto"` is not a
 * choice — it means detection should fill in, and `"auto"` is the last resort
 * so a free order still continues when detection is unsure.
 */
export function resolveGcsAnalysisLanguage(
  ordered: string | null | undefined,
  detected: string | null | undefined,
  languages: readonly string[] = [],
): string {
  const chosen = ordered?.trim() ?? "";
  if (chosen && chosen.toLowerCase() !== "auto") return chosen;
  const detectedSource = detected?.trim() ?? "";
  if (detectedSource && detectedSource.toLowerCase() !== "auto") return detectedSource;
  const first = languages[0]?.trim() ?? "";
  if (first && first.toLowerCase() !== "auto") return first;
  return "auto";
}

/** GCS uploads are one certified translation, from a single file up to `GCS_MAX_DOCUMENTS`. */
export function assertGcsDocumentCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new HttpError("Upload at least one document", 400);
  }
  if (count > GCS_MAX_DOCUMENTS) {
    throw new HttpError(`Upload at most ${GCS_MAX_DOCUMENTS} documents`, 400);
  }
}

/** Stored price for a free GCS order. Analysis must not leave a CredPronto quote on the row. */
export function gcsFreePricePatch(): { total_cents: 0; translation_cents: 0; unit_price_cents: 0 } {
  return { total_cents: 0, translation_cents: 0, unit_price_cents: 0 };
}

/**
 * Blank, "auto", and "auto-detect" mean the pipeline should detect the language.
 * Any other value has to be a supported source language.
 */
export function readGcsSourceLanguage(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /^(auto|auto-detect|detect)$/i.test(trimmed)) return null;
  const code = normalizeLanguage(trimmed);
  if (!code || !isSupportedSourceLanguage(code)) {
    throw new HttpError("Choose a source language or leave it on auto-detect", 400);
  }
  return code;
}

/** Blank or English stays English. Any other value has to be a supported language. */
export function readGcsTargetLanguage(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || /^(auto|english|en)$/i.test(trimmed)) return "en";
  const code = normalizeLanguage(trimmed);
  if (code === "en") return "en";
  if (!code || !isSupportedSourceLanguage(code)) {
    throw new HttpError("Choose a target language or leave it on English", 400);
  }
  return code;
}

export function readGcsClientName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}

/**
 * Confirmed name wins. Otherwise the name extracted from the document.
 * An email address is not printed as the client.
 */
export function gcsCoverClientName(
  confirmations: Array<{ fieldKey: string; confirmedValue: string | null; originalValue?: string | null }>,
): string {
  const confirmed = confirmations.find((field) => field.fieldKey === "full_name" && field.confirmedValue?.trim());
  if (confirmed?.confirmedValue) return confirmed.confirmedValue.trim();
  const extracted = confirmations.find((field) => field.fieldKey === "full_name" && field.originalValue?.trim());
  if (extracted?.originalValue) return extracted.originalValue.trim();
  return GCS_CLIENT_FALLBACK;
}

export function gcsSummaryLine(input: {
  sourceLabel: string;
  targetLabel: string;
  documents: number;
  pages: number;
}): string {
  const documents = input.documents === 1 ? "1 document" : `${input.documents} documents`;
  const pages = input.pages === 1 ? "1 page" : `${input.pages} pages`;
  return `${input.sourceLabel} to ${input.targetLabel} · ${documents} · ${pages}`;
}
