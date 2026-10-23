import { getAccount, isMockMode } from "@/lib/account/session";
import { HttpError } from "@/lib/orders/errors";
import { requireStaff } from "@/lib/orders/staff";
import type { Db } from "@/lib/orders/storage";

export const PREVAL_PAGE_SIZE = 50;

const CHUNK = 100;

type Row = Record<string, unknown>;

export type PrevalListRow = {
  id: string;
  email: string | null;
  createdAt: string;
  summary: string;
  orderId: string | null;
};

type Submission = {
  id: string;
  email: string | null;
  createdAt: string;
  status: string;
  equivalency: string | null;
  confidence: string | null;
  orderId: string | null;
};

export function prevalOffset(value: string | undefined | null): number {
  if (value == null || value === "" || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

/** Equivalency when the read produced one, then confidence, otherwise the read status. */
export function preEvaluationResultSummary(input: {
  status: string;
  equivalency: string | null;
  confidence: string | null;
}): string {
  const status =
    input.status === "processing"
      ? "Processing"
      : input.status === "failed"
        ? "Failed"
        : input.status === "ready"
          ? "Ready"
          : input.status.trim() || "—";
  const equivalency = input.equivalency?.trim() ?? "";
  const confidence = input.confidence?.trim() ?? "";
  if (equivalency) return `${equivalency} · ${confidence || status}`;
  return status;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapSubmission(row: Row): Submission | null {
  const id = text(row.id);
  const createdAt = text(row.created_at);
  const status = text(row.status);
  if (!id || !createdAt || !status) return null;
  return {
    id,
    email: text(row.email),
    createdAt,
    status,
    equivalency: text(row.us_equivalency),
    confidence: text(row.confidence),
    orderId: text(row.order_id),
  };
}

/** Order ids that have a payment with status exactly `paid`. */
async function paidOrderIds(db: Db, ids: string[]): Promise<Set<string>> {
  const paid = new Set<string>();
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  for (let index = 0; index < unique.length; index += CHUNK) {
    const slice = unique.slice(index, index + CHUNK);
    const { data, error } = await db.from("payments").select("order_id, status").in("order_id", slice).eq("status", "paid");
    if (error) throw new Error("Could not load pre-evaluations.");
    for (const row of (data ?? []) as Row[]) {
      if (row.status === "paid" && typeof row.order_id === "string") paid.add(row.order_id);
    }
  }
  return paid;
}

/**
 * Newest submission first. One page.
 * A paid order is `pre_evaluations.order_id` when that order has a payment status of `paid`.
 * The public access token is not selected.
 */
export async function listPreEvaluations(
  db: Db,
  page: { limit: number; offset: number },
): Promise<{ rows: PrevalListRow[]; total: number }> {
  const { data, error, count } = await db
    .from("pre_evaluations")
    .select("id, email, status, us_equivalency, confidence, order_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new Error("Could not load pre-evaluations.");
  const records = ((data ?? []) as Row[]).flatMap((row) => {
    const mapped = mapSubmission(row);
    return mapped ? [mapped] : [];
  });
  const paid =
    records.length > 0 ? await paidOrderIds(db, records.flatMap((record) => (record.orderId ? [record.orderId] : []))) : new Set<string>();
  return {
    total: typeof count === "number" ? count : page.offset + records.length,
    rows: records.map((record) => ({
      id: record.id,
      email: record.email,
      createdAt: record.createdAt,
      summary: preEvaluationResultSummary(record),
      orderId: record.orderId && paid.has(record.orderId) ? record.orderId : null,
    })),
  };
}

const MOCK_PREVAL: PrevalListRow[] = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    email: "ada@example.com",
    createdAt: "2026-10-23T18:00:00.000Z",
    summary: "Bachelor's degree · high",
    orderId: "CP-24790",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    email: null,
    createdAt: "2026-10-22T18:00:00.000Z",
    summary: "Processing",
    orderId: null,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    email: "bea@example.com",
    createdAt: "2026-10-21T18:00:00.000Z",
    summary: "Failed",
    orderId: null,
  },
];

async function mockStaffPreEvaluations(page: {
  limit: number;
  offset: number;
}): Promise<{ rows: PrevalListRow[]; total: number }> {
  const account = await getAccount();
  if (!account) throw new HttpError("Sign in required", 401);
  if (!account.isAdmin) throw new HttpError("Staff access required", 403);
  return { total: MOCK_PREVAL.length, rows: MOCK_PREVAL.slice(page.offset, page.offset + page.limit) };
}

/** Staff session, then the service-role client from requireStaff. Mock mode never opens that client. */
export async function listStaffPreEvaluations(page: {
  limit: number;
  offset: number;
}): Promise<{ rows: PrevalListRow[]; total: number }> {
  if (isMockMode()) return mockStaffPreEvaluations(page);
  const { db } = await requireStaff();
  return listPreEvaluations(db, page);
}
