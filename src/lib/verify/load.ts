import {
  fetchVerification,
  isAbortError,
  safeDocumentUrl,
  type Verification,
} from "./client";

/** The file request failed. `httpStatus` is null for a network failure, including a cross-origin block. */
export class PdfReadError extends Error {
  readonly httpStatus: number | null;

  constructor(httpStatus: number | null) {
    super("Document file could not be read");
    this.name = "PdfReadError";
    this.httpStatus = httpStatus;
  }
}

const REJECTED_TYPES = ["text/html", "application/json", "text/xml", "application/xml", "text/plain"];

export type PdfSource =
  | { kind: "blob"; blob: Blob; verification: Verification; retried: boolean }
  | { kind: "url"; url: string; verification: Verification; retried: true }
  | { kind: "unavailable"; verification: Verification; retried: boolean }
  | { kind: "status"; verification: Verification; retried: true };

type VerifyFn = (token: string, init?: { signal?: AbortSignal }) => Promise<Verification>;
type ReadFn = (url: string, signal?: AbortSignal) => Promise<Blob>;

function withoutFile(verification: Verification): Verification {
  return { ...verification, documentUrl: null };
}

/**
 * Read the signed PDF without storing it. The link expires after five minutes.
 * A failed read refetches verification once for a new link. A second HTTP failure
 * does not embed the dead link.
 * A second network failure embeds the fresh link so the browser viewer can still open it.
 */
export async function loadPdfWithOneRetry(input: {
  token: string;
  documentUrl: string;
  verification: Verification;
  signal?: AbortSignal;
  verify?: VerifyFn;
  readPdf?: ReadFn;
}): Promise<PdfSource> {
  const verify = input.verify ?? fetchVerification;
  const readPdf = input.readPdf ?? readPdfBlob;
  const firstUrl = safeDocumentUrl(input.documentUrl);
  if (!firstUrl) return { kind: "unavailable", verification: withoutFile(input.verification), retried: false };

  try {
    const blob = await readPdf(firstUrl, input.signal);
    return { kind: "blob", blob, verification: input.verification, retried: false };
  } catch (error) {
    if (isAbortError(error)) throw error;
  }

  let next: Verification;
  try {
    next = await verify(input.token, { signal: input.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { kind: "unavailable", verification: withoutFile(input.verification), retried: true };
  }

  if (next.status !== "valid") return { kind: "status", verification: withoutFile(next), retried: true };
  const nextUrl = safeDocumentUrl(next.documentUrl);
  if (!nextUrl) return { kind: "unavailable", verification: withoutFile(next), retried: true };

  try {
    const blob = await readPdf(nextUrl, input.signal);
    return { kind: "blob", blob, verification: next, retried: true };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof PdfReadError && error.httpStatus === null) {
      return { kind: "url", url: nextUrl, verification: next, retried: true };
    }
    return { kind: "unavailable", verification: withoutFile(next), retried: true };
  }
}

/** Fetch PDF bytes for inline viewing. `cache: "no-store"` so a signed link is not reused. */
export async function readPdfBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new PdfReadError(null);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PdfReadError(response.status);
  }

  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (REJECTED_TYPES.some((item) => type.includes(item))) {
    await response.body?.cancel().catch(() => undefined);
    throw new PdfReadError(response.status);
  }

  const blob = await response.blob();
  if (blob.size === 0) throw new PdfReadError(response.status);
  return blob;
}
