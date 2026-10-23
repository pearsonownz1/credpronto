import { HttpError } from "@/lib/orders/errors";
import type { Db } from "@/lib/orders/storage";
import { PRE_EVAL_STALE_MS, type PreEvalConfidence, type PreEvalMime, type PreEvalStatus } from "./constants";
import type { PreEvalSuggestion } from "./suggest";

export type PreEvaluationRecord = {
  id: string;
  tokenHash: string;
  accessToken: string;
  status: PreEvalStatus;
  storagePath: string;
  filename: string;
  mime: PreEvalMime;
  sizeBytes: number;
  ipHash: string;
  country: string | null;
  credentialName: string | null;
  usEquivalency: string | null;
  confidence: PreEvalConfidence | null;
  rationale: string | null;
  documentKind: "diploma" | "transcript" | null;
  degreeCount: number;
  edgeCredentialId: string | null;
  edgeMatchMethod: "base" | "fuzzy" | null;
  email: string | null;
  emailSubmittedAt: string | null;
  resultEmailSentAt: string | null;
  suggestionStartedAt: string | null;
  createdAt: string;
};

type Row = Record<string, unknown>;

function unavailable(): never {
  throw new HttpError("Pre-evaluation storage is unavailable", 503);
}

function fail(error: { message: string } | null): void {
  if (error) unavailable();
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function confidence(value: unknown): PreEvalConfidence | null {
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

function status(value: unknown): PreEvalStatus | null {
  if (value === "processing" || value === "ready" || value === "failed") return value;
  return null;
}

function mime(value: unknown): PreEvalMime | null {
  if (value === "application/pdf" || value === "image/jpeg" || value === "image/png") return value;
  return null;
}

export function mapPreEvaluation(row: Row): PreEvaluationRecord | null {
  const id = text(row.id);
  const tokenHash = text(row.token_hash);
  const accessToken = text(row.access_token);
  const rowStatus = status(row.status);
  const storagePath = text(row.storage_path);
  const filename = text(row.filename);
  const rowMime = mime(row.mime);
  const ipHash = text(row.ip_hash);
  const sizeBytes = typeof row.size_bytes === "number" ? row.size_bytes : Number(row.size_bytes);
  if (!id || !tokenHash || !accessToken || !rowStatus || !storagePath || !filename || !rowMime || !ipHash) {
    return null;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  const kind = row.document_kind === "diploma" || row.document_kind === "transcript" ? row.document_kind : null;
  const match = row.edge_match_method === "base" || row.edge_match_method === "fuzzy" ? row.edge_match_method : null;
  const degree = typeof row.degree_count === "number" ? row.degree_count : Number(row.degree_count);
  return {
    id,
    tokenHash,
    accessToken,
    status: rowStatus,
    storagePath,
    filename,
    mime: rowMime,
    sizeBytes,
    ipHash,
    country: text(row.country),
    credentialName: text(row.credential_name),
    usEquivalency: text(row.us_equivalency),
    confidence: confidence(row.confidence),
    rationale: text(row.rationale),
    documentKind: kind,
    degreeCount: Number.isFinite(degree) && degree >= 1 ? Math.min(5, Math.trunc(degree)) : 1,
    edgeCredentialId: text(row.edge_credential_id),
    edgeMatchMethod: match,
    email: text(row.email),
    emailSubmittedAt: text(row.email_submitted_at),
    resultEmailSentAt: text(row.result_email_sent_at),
    suggestionStartedAt: text(row.suggestion_started_at),
    createdAt: text(row.created_at) ?? new Date(0).toISOString(),
  };
}

const COLUMNS =
  "id, token_hash, access_token, status, storage_path, filename, mime, size_bytes, ip_hash, country, credential_name, us_equivalency, confidence, rationale, document_kind, degree_count, edge_credential_id, edge_match_method, email, email_submitted_at, result_email_sent_at, suggestion_started_at, created_at";

export async function countPreEvaluationsByIp(db: Db, ipHash: string, sinceIso: string): Promise<number> {
  const { count, error } = await db
    .from("pre_evaluations")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceIso);
  fail(error);
  return count ?? 0;
}

export async function countPreEvaluationEmailsByIp(db: Db, ipHash: string, sinceIso: string): Promise<number> {
  const { count, error } = await db
    .from("pre_evaluations")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("email_submitted_at", sinceIso);
  fail(error);
  return count ?? 0;
}

export async function insertPreEvaluation(
  db: Db,
  input: {
    id: string;
    tokenHash: string;
    accessToken: string;
    storagePath: string;
    filename: string;
    mime: PreEvalMime;
    sizeBytes: number;
    ipHash: string;
  },
): Promise<void> {
  const { error } = await db.from("pre_evaluations").insert({
    id: input.id,
    token_hash: input.tokenHash,
    access_token: input.accessToken,
    status: "processing",
    storage_path: input.storagePath,
    filename: input.filename,
    mime: input.mime,
    size_bytes: input.sizeBytes,
    ip_hash: input.ipHash,
  });
  fail(error);
}

export async function preEvaluationByTokenHash(db: Db, tokenHash: string): Promise<PreEvaluationRecord | null> {
  const { data, error } = await db.from("pre_evaluations").select(COLUMNS).eq("token_hash", tokenHash).maybeSingle();
  fail(error);
  return data ? mapPreEvaluation(data as Row) : null;
}

export async function preEvaluationById(db: Db, id: string): Promise<PreEvaluationRecord | null> {
  const { data, error } = await db.from("pre_evaluations").select(COLUMNS).eq("id", id).maybeSingle();
  fail(error);
  return data ? mapPreEvaluation(data as Row) : null;
}

/** A fresh claim blocks other workers. A quiet one can be taken again. */
export function suggestionClaimable(startedAt: string | null, nowIso: string): boolean {
  if (!startedAt) return true;
  const started = Date.parse(startedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return true;
  return now - started >= PRE_EVAL_STALE_MS;
}

/** One worker owns the suggestion. A quiet row can be claimed again. */
export async function claimPreEvaluation(db: Db, id: string, nowIso: string): Promise<PreEvaluationRecord | null> {
  const current = await preEvaluationById(db, id);
  if (!current || current.status !== "processing") return null;
  if (!suggestionClaimable(current.suggestionStartedAt, nowIso)) return null;
  let query = db
    .from("pre_evaluations")
    .update({ suggestion_started_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .eq("status", "processing");
  query = current.suggestionStartedAt
    ? query.eq("suggestion_started_at", current.suggestionStartedAt)
    : query.is("suggestion_started_at", null);
  const { data, error } = await query.select(COLUMNS);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapPreEvaluation(row) : null;
}

export async function finishPreEvaluation(db: Db, id: string, suggestion: PreEvalSuggestion, nowIso: string): Promise<void> {
  const { error } = await db
    .from("pre_evaluations")
    .update({
      status: "ready",
      country: suggestion.country,
      credential_name: suggestion.credentialName,
      us_equivalency: suggestion.equivalent,
      confidence: suggestion.confidence,
      rationale: suggestion.rationale,
      document_kind: suggestion.documentKind,
      degree_count: suggestion.degreeCount,
      edge_credential_id: suggestion.edgeCredentialId,
      edge_match_method: suggestion.edgeMatchMethod,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "processing");
  fail(error);
}

export async function failPreEvaluation(db: Db, id: string, nowIso: string): Promise<void> {
  const { error } = await db
    .from("pre_evaluations")
    .update({ status: "failed", suggestion_started_at: null, updated_at: nowIso })
    .eq("id", id)
    .eq("status", "processing");
  fail(error);
}

export async function savePreEvaluationEmail(
  db: Db,
  tokenHash: string,
  email: string,
  nowIso: string,
): Promise<"saved" | "taken" | "missing"> {
  const { data, error } = await db
    .from("pre_evaluations")
    .update({ email, email_submitted_at: nowIso, updated_at: nowIso })
    .eq("token_hash", tokenHash)
    .is("email", null)
    .select("id");
  fail(error);
  if ((data ?? []).length > 0) return "saved";
  const existing = await preEvaluationByTokenHash(db, tokenHash);
  if (!existing) return "missing";
  return "taken";
}

/** Claim the one result email. A false return means another caller already claimed it. */
export async function claimResultEmail(db: Db, id: string, nowIso: string): Promise<boolean> {
  const { data, error } = await db
    .from("pre_evaluations")
    .update({ result_email_sent_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .eq("status", "ready")
    .not("email", "is", null)
    .is("result_email_sent_at", null)
    .select("id");
  fail(error);
  return (data ?? []).length > 0;
}

export async function clearResultEmailClaim(db: Db, id: string, nowIso: string): Promise<void> {
  const { error } = await db
    .from("pre_evaluations")
    .update({ result_email_sent_at: null })
    .eq("id", id)
    .eq("result_email_sent_at", nowIso);
  fail(error);
}
