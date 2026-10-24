/**
 * Instant preview API. Backend owns the routes; keep every call here.
 *
 * POST /api/pre-evaluation
 *   multipart field `file` → { id }
 * GET /api/pre-evaluation/{id}
 *   { status: 'email_required' | 'processing' | 'ready' | 'failed',
 *     equivalent, confidence, previewUrl, kind }
 *   Until the email is submitted, status is `email_required` and the three
 *   result fields are null. `kind` is `diploma`, `transcript`, or null until
 *   the document is classified, including while the email is still required.
 *   This payload never includes the file name, size, or page count.
 *   `previewUrl` is a signed link that expires in about five minutes. Do not store it.
 * POST /api/pre-evaluation/{id}/email
 *   JSON { email } → { ok: true }
 * GET /api/pre-evaluation/{id}/prefill
 *   Email and order fields for signup. 409 until the lead email exists.
 * GET /api/pre-evaluation/{id}/file
 *   Signed-in owner only. 404 otherwise.
 *   { preEvaluationFile: { name, mimeType, size, pageCount, kind } }
 *   kind is diploma or transcript. The upload form prices from kind.
 */

export const PRE_EVALUATION_POLL_MS = 2_000;

export const RATE_LIMIT_MESSAGE = "Too many requests";

export const REJECTED_FILE_MESSAGE = "Upload a PDF, JPG, or PNG";

export type PreEvaluationStatus = "processing" | "email_required" | "ready" | "failed";

export type PreEvaluationConfidence = "low" | "medium" | "high";

export type PreEvaluationFileKind = "diploma" | "transcript";

export type PreEvaluationRecord = {
  status: PreEvaluationStatus;
  equivalent: string | null;
  confidence: PreEvaluationConfidence | null;
  previewUrl: string | null;
  kind: PreEvaluationFileKind | null;
};

export type PreEvaluationCreated = {
  id: string;
};

export type PreEvaluationEmailResult = {
  ok: true;
};

export type PreEvaluationService = "diploma" | "course_by_course";

export type PreEvaluationFile = {
  name: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  size: number;
  pageCount: number;
  kind: PreEvaluationFileKind;
};

export type PreEvaluationPrefill = {
  email: string;
  orderType: "evaluation";
  service: PreEvaluationService;
  degreeCount: number;
  country: string | null;
  credentialName: string | null;
  equivalent: string | null;
  confidence: PreEvaluationConfidence | null;
  rationale: string | null;
  status: "processing" | "ready" | "failed";
  signupPath: string;
  orderPath: string;
  resultPath: string;
};

const STATUSES = new Set<PreEvaluationStatus>(["processing", "email_required", "ready", "failed"]);
const CONFIDENCE = new Set<PreEvaluationConfidence>(["low", "medium", "high"]);
const SERVICES = new Set<PreEvaluationService>(["diploma", "course_by_course"]);
const PREFILL_STATUSES = new Set<PreEvaluationPrefill["status"]>(["processing", "ready", "failed"]);

export class PreEvaluationClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PreEvaluationClientError";
    this.status = status;
  }
}

export function preEvaluationErrorStatus(cause: unknown): { status: number; message: string } {
  if (cause instanceof PreEvaluationClientError) return { status: cause.status, message: cause.message };
  return { status: 503, message: "We couldn't finish that request. Please try again." };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function previewId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed || /[/?#\\]/.test(trimmed) || trimmed.includes("..")) {
    throw new PreEvaluationClientError("Pre-evaluation not found", 404);
  }
  return trimmed;
}

function errorText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || typeof (payload as { error?: unknown }).error !== "string") return "";
  const text = (payload as { error: string }).error.trim();
  if (!text || text === "Request failed") return "";
  return text.slice(0, 300);
}

function messageFrom(payload: unknown, status: number): string {
  const text = errorText(payload);
  if (text) return text;
  if (status === 429) return RATE_LIMIT_MESSAGE;
  if (status === 415) return REJECTED_FILE_MESSAGE;
  return "We couldn't finish that request. Please try again.";
}

async function readPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function send(fetchImpl: FetchLike, path: string, init: RequestInit): Promise<{ response: Response; payload: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(path, { credentials: "include", ...init, cache: "no-store" });
  } catch {
    throw new PreEvaluationClientError("We couldn't finish that request. Please try again.", 503);
  }
  const payload = await readPayload(response);
  if (!response.ok) throw new PreEvaluationClientError(messageFrom(payload, response.status), response.status);
  return { response, payload };
}

function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function publicKind(value: unknown): PreEvaluationFileKind | null {
  return value === "diploma" || value === "transcript" ? value : null;
}

export function parsePreEvaluation(payload: unknown): PreEvaluationRecord {
  if (!payload || typeof payload !== "object") {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const row = payload as { status?: unknown; equivalent?: unknown; confidence?: unknown; previewUrl?: unknown; kind?: unknown };
  const status = row.status;
  if (typeof status !== "string" || !STATUSES.has(status as PreEvaluationStatus)) {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const kind = publicKind(row.kind);
  const parsed = status as PreEvaluationStatus;
  if (parsed !== "ready") {
    return { status: parsed, equivalent: null, confidence: null, previewUrl: null, kind };
  }
  const confidence =
    typeof row.confidence === "string" && CONFIDENCE.has(row.confidence as PreEvaluationConfidence)
      ? (row.confidence as PreEvaluationConfidence)
      : null;
  return {
    status: "ready",
    equivalent: nullableText(row.equivalent),
    confidence,
    previewUrl: nullableText(row.previewUrl),
    kind,
  };
}

/**
 * A signed preview link expires after about five minutes.
 * The first load failure may be replaced. Another failure is not.
 */
export function replacementPreviewUrl(record: PreEvaluationRecord, failures: number): string | null {
  if (failures !== 1 || record.status !== "ready") return null;
  return record.previewUrl;
}

function parseCreated(payload: unknown): PreEvaluationCreated {
  const id = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id.trim()) {
    throw new PreEvaluationClientError("The preview did not start.", 502);
  }
  return { id: previewId(id) };
}

function parseEmailResult(payload: unknown): PreEvaluationEmailResult {
  if (!payload || typeof payload !== "object" || (payload as { ok?: unknown }).ok !== true) {
    throw new PreEvaluationClientError("We couldn't save that email. Please try again.", 502);
  }
  return { ok: true };
}

export function parsePreEvaluationPrefill(payload: unknown): PreEvaluationPrefill {
  if (!payload || typeof payload !== "object") {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const row = payload as Record<string, unknown>;
  const email = nullableText(row.email);
  const service = row.service;
  const status = row.status;
  const signupPath = nullableText(row.signupPath);
  const orderPath = nullableText(row.orderPath);
  const resultPath = nullableText(row.resultPath);
  const degreeCount = row.degreeCount;
  if (
    !email ||
    row.orderType !== "evaluation" ||
    typeof service !== "string" ||
    !SERVICES.has(service as PreEvaluationService) ||
    typeof status !== "string" ||
    !PREFILL_STATUSES.has(status as PreEvaluationPrefill["status"]) ||
    typeof degreeCount !== "number" ||
    !Number.isInteger(degreeCount) ||
    degreeCount < 1 ||
    !signupPath ||
    !orderPath ||
    !resultPath
  ) {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const ready = status === "ready";
  const confidence =
    ready && typeof row.confidence === "string" && CONFIDENCE.has(row.confidence as PreEvaluationConfidence)
      ? (row.confidence as PreEvaluationConfidence)
      : null;
  return {
    email,
    orderType: "evaluation",
    service: service as PreEvaluationService,
    degreeCount,
    country: ready ? nullableText(row.country) : null,
    credentialName: ready ? nullableText(row.credentialName) : null,
    equivalent: ready ? nullableText(row.equivalent) : null,
    confidence,
    rationale: ready ? nullableText(row.rationale) : null,
    status: status as PreEvaluationPrefill["status"],
    signupPath,
    orderPath,
    resultPath,
  };
}

/** POST /api/pre-evaluation with multipart field `file`. */
export async function createPreEvaluation(file: File, fetchImpl: FetchLike = fetch): Promise<PreEvaluationCreated> {
  const body = new FormData();
  body.append("file", file, file.name);
  const { payload } = await send(fetchImpl, "/api/pre-evaluation", {
    method: "POST",
    body,
    headers: { accept: "application/json" },
  });
  return parseCreated(payload);
}

/** GET /api/pre-evaluation/{id}. `email_required` has null results. The signed preview URL is not cached. */
export async function getPreEvaluation(id: string, fetchImpl: FetchLike = fetch): Promise<PreEvaluationRecord> {
  const safeId = previewId(id);
  const { payload } = await send(fetchImpl, `/api/pre-evaluation/${encodeURIComponent(safeId)}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return parsePreEvaluation(payload);
}

/** POST /api/pre-evaluation/{id}/email with `{ email }` → `{ ok: true }`. */
export async function submitPreEvaluationEmail(
  id: string,
  email: string,
  fetchImpl: FetchLike = fetch,
): Promise<PreEvaluationEmailResult> {
  const safeId = previewId(id);
  const { payload } = await send(fetchImpl, `/api/pre-evaluation/${encodeURIComponent(safeId)}/email`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim() }),
  });
  return parseEmailResult(payload);
}

const FILE_MIMES = new Set<PreEvaluationFile["mimeType"]>(["application/pdf", "image/jpeg", "image/png"]);
const FILE_KINDS = new Set<PreEvaluationFileKind>(["diploma", "transcript"]);

/** Paid-funnel file. The object has exactly these keys. */
export function parsePreEvaluationFile(payload: unknown): { preEvaluationFile: PreEvaluationFile } {
  if (!payload || typeof payload !== "object") {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const file = (payload as { preEvaluationFile?: unknown }).preEvaluationFile;
  if (!file || typeof file !== "object") {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const row = file as Record<string, unknown>;
  const name = nullableText(row.name);
  const mimeType = row.mimeType;
  const kind = row.kind;
  const size = row.size;
  const pageCount = row.pageCount;
  if (
    !name ||
    typeof mimeType !== "string" ||
    !FILE_MIMES.has(mimeType as PreEvaluationFile["mimeType"]) ||
    typeof kind !== "string" ||
    !FILE_KINDS.has(kind as PreEvaluationFileKind) ||
    typeof size !== "number" ||
    !Number.isInteger(size) ||
    size < 1 ||
    typeof pageCount !== "number" ||
    !Number.isInteger(pageCount) ||
    pageCount < 1
  ) {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  return {
    preEvaluationFile: {
      name,
      mimeType: mimeType as PreEvaluationFile["mimeType"],
      size,
      pageCount,
      kind: kind as PreEvaluationFileKind,
    },
  };
}

/** GET /api/pre-evaluation/{id}/prefill. Signup and the order form use these fields. */
export async function getPreEvaluationPrefill(id: string, fetchImpl: FetchLike = fetch): Promise<PreEvaluationPrefill> {
  const safeId = previewId(id);
  const { payload } = await send(fetchImpl, `/api/pre-evaluation/${encodeURIComponent(safeId)}/prefill`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return parsePreEvaluationPrefill(payload);
}

/** GET /api/pre-evaluation/{id}/file. Signed-in owner. The file is already on the order form. */
export async function getPreEvaluationFile(
  id: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ preEvaluationFile: PreEvaluationFile }> {
  const safeId = previewId(id);
  const { payload } = await send(fetchImpl, `/api/pre-evaluation/${encodeURIComponent(safeId)}/file`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return parsePreEvaluationFile(payload);
}
