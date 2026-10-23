import type { Verification, VerifyDocumentType } from "./client";

export const FILE_UNAVAILABLE = "The document link expired. Try again to open it.";

export function documentTypeLabel(type: VerifyDocumentType | null): string | null {
  if (type === "evaluation") return "Evaluation";
  if (type === "translation") return "Translation";
  return null;
}

/** Calendar date in UTC so a date-only timestamp does not shift a day. */
export function formatIssuedOn(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function verificationFacts(verification: Verification): {
  typeLabel: string | null;
  issuedOn: string | null;
  reference: string | null;
} {
  return {
    typeLabel: documentTypeLabel(verification.type),
    issuedOn: formatIssuedOn(verification.issuedAt),
    reference: verification.reference,
  };
}

export function downloadFilename(reference: string | null): string {
  const safe = (reference ?? "").replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 48);
  return safe ? `credpronto-${safe}.pdf` : "credpronto-document.pdf";
}
