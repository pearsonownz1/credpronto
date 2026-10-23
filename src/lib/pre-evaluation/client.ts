/**
 * Instant preview API. Backend owns the routes; keep every call here.
 *
 * POST /api/pre-evaluation
 *   multipart field `file` → { id }
 * GET /api/pre-evaluation/{id}
 *   { status: 'processing' | 'email_required' | 'done' | 'failed',
 *     equivalent, confidence, previewUrl }
 *   Until the email is submitted, status is `email_required` and the three
 *   result fields are null.
 * POST /api/pre-evaluation/{id}/email
 *   JSON { email } — also emails the preview. Then GET can return `done`.
 */

import { DIRECT_FILE_LIMIT_MESSAGE } from "@/lib/orders/constants";

export const PRE_EVALUATION_POLL_MS = 2_000;

export const RATE_LIMIT_MESSAGE = "Too many previews right now. Please wait a moment and try again.";

export type PreEvaluationStatus = "processing" | "email_required" | "done" | "failed";

export type PreEvaluationConfidence = "low" | "medium" | "high";

export type PreEvaluationRecord = {
  status: PreEvaluationStatus;
  equivalent: string | null;
  confidence: PreEvaluationConfidence | null;
  previewUrl: string | null;
};

export type PreEvaluationCreated = {
  id: string;
};

const STATUSES = new Set<PreEvaluationStatus>(["processing", "email_required", "done", "failed"]);
const CONFIDENCE = new Set<PreEvaluationConfidence>(["low", "medium", "high"]);

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
    throw new PreEvaluationClientError("That preview link is not valid.", 400);
  }
  return trimmed;
}

function messageFrom(payload: unknown, status: number): string {
  if (status === 429) return RATE_LIMIT_MESSAGE;
  if (payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string") {
    const text = (payload as { error: string }).error.trim();
    if (text && text !== "Request failed") return text.slice(0, 300);
  }
  if (status === 413) return DIRECT_FILE_LIMIT_MESSAGE;
  return "We couldn't finish that request. Please try again.";
}

async function readPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function send(fetchImpl: FetchLike, path: string, init: RequestInit): Promise<{ response: Response; payload: unknown }> {
  let response: Response;
  try {
    response = await fetchImpl(path, { credentials: "include", ...init });
  } catch {
    throw new PreEvaluationClientError("We couldn't finish that request. Please try again.", 503);
  }
  const payload = await readPayload(response);
  if (!response.ok) throw new PreEvaluationClientError(messageFrom(payload, response.status), response.status);
  return { response, payload };
}

export function parsePreEvaluation(payload: unknown): PreEvaluationRecord {
  if (!payload || typeof payload !== "object") {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const status = (payload as { status?: unknown }).status;
  if (typeof status !== "string" || !STATUSES.has(status as PreEvaluationStatus)) {
    throw new PreEvaluationClientError("The preview response was not valid.", 502);
  }
  const parsed = status as PreEvaluationStatus;
  if (parsed !== "done") {
    return { status: parsed, equivalent: null, confidence: null, previewUrl: null };
  }
  const row = payload as { equivalent?: unknown; confidence?: unknown; previewUrl?: unknown };
  const equivalent = typeof row.equivalent === "string" ? row.equivalent.trim() : "";
  const confidence =
    typeof row.confidence === "string" && CONFIDENCE.has(row.confidence as PreEvaluationConfidence)
      ? (row.confidence as PreEvaluationConfidence)
      : null;
  const previewUrl = typeof row.previewUrl === "string" && row.previewUrl.trim() ? row.previewUrl.trim() : null;
  return {
    status: "done",
    equivalent: equivalent || null,
    confidence,
    previewUrl,
  };
}

function parseCreated(payload: unknown): PreEvaluationCreated {
  const id = payload && typeof payload === "object" ? (payload as { id?: unknown }).id : null;
  if (typeof id !== "string" || !id.trim()) {
    throw new PreEvaluationClientError("The preview did not start.", 502);
  }
  return { id: previewId(id) };
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

/** GET /api/pre-evaluation/{id}. `email_required` has null results. */
export async function getPreEvaluation(id: string, fetchImpl: FetchLike = fetch): Promise<PreEvaluationRecord> {
  const safeId = previewId(id);
  const { payload } = await send(fetchImpl, `/api/pre-evaluation/${encodeURIComponent(safeId)}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  return parsePreEvaluation(payload);
}

/** POST /api/pre-evaluation/{id}/email with `{ email }`. The preview is emailed too. */
export async function submitPreEvaluationEmail(id: string, email: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const safeId = previewId(id);
  await send(fetchImpl, `/api/pre-evaluation/${encodeURIComponent(safeId)}/email`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim() }),
  });
}
