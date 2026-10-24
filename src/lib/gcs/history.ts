import { storedEvaluationFile } from "@/lib/orders/evaluation-summary";
import { parseEvaluationResult } from "@/lib/orders/evaluation-price";
import type { Db } from "@/lib/orders/storage";
import { ORDER_STATUSES } from "@/lib/orders/types";
import type { EvaluationService } from "@/lib/orders/types";

export type GcsHistoryItem = {
  id: string;
  status: string;
  title: string;
  filenames: string[];
  documentCount: number;
  pageCount: number;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  hasEvaluation: boolean;
  evaluationKind: EvaluationService | null;
  createdAt: string;
};

const EXCLUDED = new Set(["cancelled", "failed"]);

/** Recent GCS translations. Cancelled and failed rows stay off the desk sidebar. */
export const GCS_HISTORY_STATUSES = ORDER_STATUSES.filter((status) => !EXCLUDED.has(status));

export const GCS_HISTORY_LIMIT = 50;

const GCS_HISTORY_COLUMNS = [
  "id",
  "brand",
  "status",
  "source_language",
  "target_language",
  "billable_pages",
  "created_at",
  "service_files",
  "evaluation_result",
  "documents(filename, position, page_count)",
  "confirmations(field_key, confirmed_value, original_value)",
].join(", ");

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function serviceFiles(value: unknown): Partial<Record<EvaluationService, string>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const files: Partial<Record<EvaluationService, string>> = {};
  const diploma = text(record.diploma);
  const course = text(record.course_by_course);
  if (diploma) files.diploma = diploma;
  if (course) files.course_by_course = course;
  return files.diploma || files.course_by_course ? files : null;
}

function documentsOf(value: unknown): Array<{ filename: string; position: number; pageCount: number | null }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Row => item != null && typeof item === "object")
    .map((row) => ({
      filename: text(row.filename) ?? "Document",
      position: num(row.position) ?? 0,
      pageCount: num(row.page_count),
    }))
    .sort((a, b) => a.position - b.position || a.filename.localeCompare(b.filename));
}

function clientName(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const names = value.filter(
    (item): item is Row => item != null && typeof item === "object" && item.field_key === "full_name",
  );
  for (const row of names) {
    const confirmed = text(row.confirmed_value);
    if (confirmed) return confirmed;
  }
  for (const row of names) {
    const original = text(row.original_value);
    if (original) return original;
  }
  return null;
}

export function gcsHistoryFilenameLabel(filenames: readonly string[]): string {
  if (filenames.length === 0) return "Document";
  if (filenames.length === 1) return filenames[0] ?? "Document";
  return `${filenames[0]} + ${filenames.length - 1} more`;
}

export function mapGcsHistoryRow(row: Row): GcsHistoryItem | null {
  const id = text(row.id);
  const status = text(row.status);
  if (!id || !status || EXCLUDED.has(status)) return null;
  if (row.brand != null && row.brand !== "gcs") return null;
  const documents = documentsOf(row.documents);
  const filenames = documents.map((document) => document.filename);
  const name = clientName(row.confirmations);
  const files = serviceFiles(row.service_files);
  const stored = storedEvaluationFile(files);
  const evaluationResult = parseEvaluationResult(row.evaluation_result);
  const hasEvaluation = Boolean(stored || evaluationResult);
  const summed = documents.reduce((sum, document) => sum + (document.pageCount ?? 0), 0);
  return {
    id,
    status,
    title: name || gcsHistoryFilenameLabel(filenames),
    filenames,
    documentCount: filenames.length,
    pageCount: num(row.billable_pages) ?? summed,
    sourceLanguage: text(row.source_language),
    targetLanguage: text(row.target_language),
    hasEvaluation,
    evaluationKind: stored?.kind ?? evaluationResult?.kind ?? null,
    createdAt: text(row.created_at) ?? new Date(0).toISOString(),
  };
}

export async function listGcsHistory(db: Db): Promise<GcsHistoryItem[]> {
  const { data, error } = await db
    .from("orders")
    .select(GCS_HISTORY_COLUMNS)
    .eq("brand", "gcs")
    .in("status", [...GCS_HISTORY_STATUSES])
    .order("created_at", { ascending: false })
    .limit(GCS_HISTORY_LIMIT);
  if (error) throw new Error(error.message || "Could not load translations");
  return ((data ?? []) as unknown as Row[]).flatMap((row) => {
    const item = mapGcsHistoryRow(row);
    return item ? [item] : [];
  });
}
