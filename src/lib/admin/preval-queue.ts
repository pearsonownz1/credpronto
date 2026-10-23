import { getAccount, isMockMode } from "@/lib/account/session";
import { HttpError } from "@/lib/orders/errors";
import { requireStaff } from "@/lib/orders/staff";
import type { Db } from "@/lib/orders/storage";

export const PREVAL_PAGE_SIZE = 50;

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const CHUNK = 100;
const OR_CHUNK = 25;

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
  publicId: string;
  linkedOrderId: string | null;
  email: string | null;
  createdAt: string;
  status: string;
  equivalency: string | null;
  confidence: string | null;
};

export type PaidOrderCandidate = {
  id: string;
  /** Exact `preEvaluation` query value on the order, when the order stored one. */
  preEvaluationId: string | null;
  paymentStatus: string | null;
  createdAt: string;
};

export function prevalOffset(value: string | undefined | null): number {
  if (value == null || value === "" || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

/** The `preEvaluation` query value on an order landing path. */
export function preEvaluationParam(value: string | null): string | null {
  if (!value) return null;
  const query = value.includes("?") ? value.slice(value.indexOf("?") + 1) : value;
  const id = new URLSearchParams(query).get("preEvaluation")?.trim() ?? "";
  if (!id || !SAFE_ID.test(id)) return null;
  return id;
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

function time(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesSubmission(submission: Pick<Submission, "id" | "publicId" | "linkedOrderId">, order: PaidOrderCandidate): boolean {
  if (submission.linkedOrderId && order.id === submission.linkedOrderId) return true;
  if (!order.preEvaluationId) return false;
  return order.preEvaluationId === submission.publicId || order.preEvaluationId === submission.id;
}

/**
 * A converted submission has a paid order created with `preEvaluation=<id>`.
 * `id` is the public pre-evaluation id, or the internal id when that was what the order stored.
 * `pre_evaluations.order_id` is the same link, written when the order is created with that id.
 * Payment status must be `paid`.
 */
export function paidOrderForSubmission(
  submission: Pick<Submission, "id" | "publicId" | "linkedOrderId">,
  orders: readonly PaidOrderCandidate[],
): string | null {
  const matches = orders.filter((order) => order.paymentStatus === "paid" && matchesSubmission(submission, order));
  if (matches.length === 0) return null;
  const ranked = [...matches].sort((a, b) => {
    const byTime = time(b.createdAt) - time(a.createdAt);
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return ranked[0]?.id ?? null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapSubmission(row: Row): Submission | null {
  const id = text(row.id);
  const publicId = text(row.access_token);
  const createdAt = text(row.created_at);
  const status = text(row.status);
  if (!id || !publicId || !createdAt || !status) return null;
  return {
    id,
    publicId,
    linkedOrderId: text(row.order_id),
    email: text(row.email),
    createdAt,
    status,
    equivalency: text(row.us_equivalency),
    confidence: text(row.confidence),
  };
}

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

async function ordersByPreEvaluationParam(
  db: Db,
  ids: string[],
): Promise<Array<{ id: string; preEvaluationId: string; createdAt: string }>> {
  const unique = [...new Set(ids.filter((id) => SAFE_ID.test(id)))];
  const found = new Map<string, { id: string; preEvaluationId: string; createdAt: string }>();
  for (let index = 0; index < unique.length; index += OR_CHUNK) {
    const slice = unique.slice(index, index + OR_CHUNK);
    const filter = slice.map((id) => `landing_path.ilike.*preEvaluation=${id}*`).join(",");
    const { data, error } = await db.from("orders").select("id, landing_path, created_at").or(filter);
    if (error) throw new Error("Could not load pre-evaluations.");
    for (const row of (data ?? []) as Row[]) {
      const id = text(row.id);
      const param = preEvaluationParam(typeof row.landing_path === "string" ? row.landing_path : null);
      if (!id || !param || !unique.includes(param)) continue;
      found.set(id, { id, preEvaluationId: param, createdAt: text(row.created_at) ?? "" });
    }
  }
  return [...found.values()];
}

async function paidOrdersFor(db: Db, records: Submission[]): Promise<PaidOrderCandidate[]> {
  const linkedIds = records.flatMap((record) => (record.linkedOrderId ? [record.linkedOrderId] : []));
  const keys = records.flatMap((record) => [record.publicId, record.id]);
  const landing = await ordersByPreEvaluationParam(db, keys);
  const byId = new Map<string, PaidOrderCandidate>();
  for (const order of landing) {
    byId.set(order.id, { ...order, paymentStatus: null });
  }
  const missing = linkedIds.filter((id) => !byId.has(id));
  for (let index = 0; index < missing.length; index += CHUNK) {
    const slice = missing.slice(index, index + CHUNK);
    const { data, error } = await db.from("orders").select("id, created_at").in("id", slice);
    if (error) throw new Error("Could not load pre-evaluations.");
    for (const row of (data ?? []) as Row[]) {
      const id = text(row.id);
      if (!id || byId.has(id)) continue;
      byId.set(id, {
        id,
        preEvaluationId: null,
        paymentStatus: null,
        createdAt: text(row.created_at) ?? "",
      });
    }
  }
  const paid = await paidOrderIds(db, [...byId.keys()]);
  return [...byId.values()]
    .filter((order) => paid.has(order.id))
    .map((order) => ({ ...order, paymentStatus: "paid" }));
}

/** Newest submission first. One page. The public id stays on the server. */
export async function listPreEvaluations(
  db: Db,
  page: { limit: number; offset: number },
): Promise<{ rows: PrevalListRow[]; total: number }> {
  const { data, error, count } = await db
    .from("pre_evaluations")
    .select("id, access_token, email, status, us_equivalency, confidence, order_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new Error("Could not load pre-evaluations.");
  const records = ((data ?? []) as Row[]).flatMap((row) => {
    const mapped = mapSubmission(row);
    return mapped ? [mapped] : [];
  });
  const paid = records.length > 0 ? await paidOrdersFor(db, records) : [];
  return {
    total: typeof count === "number" ? count : page.offset + records.length,
    rows: records.map((record) => ({
      id: record.id,
      email: record.email,
      createdAt: record.createdAt,
      summary: preEvaluationResultSummary(record),
      orderId: paidOrderForSubmission(record, paid),
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
