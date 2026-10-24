export const VERIFY_API_PATH = "/api/verify";

/** Signed PDF links from GET /api/verify/{token} expire after 300 seconds. */
export const SIGNED_PDF_TTL_SECONDS = 300;

export type VerifyStatus = "valid" | "revoked" | "not_found";
export type VerifyDocumentType = "evaluation" | "translation";

/** Public verification facts. Extra API fields are dropped so the page cannot render them. */
export type Verification = {
  status: VerifyStatus;
  type: VerifyDocumentType | null;
  issuedAt: string | null;
  documentUrl: string | null;
  reference: string | null;
};

export class VerifyRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Verification request failed");
    this.name = "VerifyRequestError";
    this.status = status;
  }
}

const NOT_FOUND: Verification = {
  status: "not_found",
  type: null,
  issuedAt: null,
  documentUrl: null,
  reference: null,
};

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Absolute http(s) PDF link with no embedded credentials. */
export function safeDocumentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

function documentType(value: unknown): VerifyDocumentType | null {
  return value === "evaluation" || value === "translation" ? value : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseVerification(body: unknown): Verification | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const status = record.status;
  if (status === "not_found") return { ...NOT_FOUND };
  if (status !== "valid" && status !== "revoked") return null;
  return {
    status,
    type: documentType(record.type),
    issuedAt: text(record.issuedAt),
    // Present only when status is valid. The signed URL expires after SIGNED_PDF_TTL_SECONDS.
    documentUrl: status === "valid" ? safeDocumentUrl(record.documentUrl) : null,
    reference: text(record.reference),
  };
}

export function verifyRequestPath(token: string): string {
  return `${VERIFY_API_PATH}/${encodeURIComponent(token)}`;
}

/**
 * GET /api/verify/{token}.
 * HTTP 200 carries status valid, revoked, or not_found. The signed PDF URL
 * lasts SIGNED_PDF_TTL_SECONDS and is omitted unless the document is valid.
 * 429 and 503 are failures, not document states. Nothing from this call is cached.
 */
export async function fetchVerification(
  token: string,
  init?: { signal?: AbortSignal },
): Promise<Verification> {
  let response: Response;
  try {
    response = await fetch(verifyRequestPath(token), {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: init?.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new VerifyRequestError(0);
  }

  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      throw new VerifyRequestError(response.status);
    }
  }

  const parsed = parseVerification(body);
  if (!response.ok || !parsed) throw new VerifyRequestError(response.status);
  return parsed;
}
