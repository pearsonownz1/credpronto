import { getAccount, isMockMode } from "@/lib/account/session";
import { HttpError } from "@/lib/orders/errors";
import { requireStaff } from "@/lib/orders/staff";
import type { Db } from "@/lib/orders/storage";

export const CORRECTION_FILTERS = ["open", "fixed", "all"] as const;
export const CORRECTION_PAGE_SIZE = 50;

export type CorrectionFilter = (typeof CORRECTION_FILTERS)[number];

export type CorrectionQueueRow = {
  id: string;
  orderId: string;
  email: string | null;
  note: string;
  status: "open" | "in_progress" | "fixed";
  requestedAt: string;
  fixedAt: string | null;
};

const STATUSES = ["open", "in_progress", "fixed"] as const;
const CHUNK = 100;

type Row = Record<string, unknown>;

export function correctionListFilter(value: string | undefined | null): CorrectionFilter {
  if (value === "fixed" || value === "all" || value === "open") return value;
  return "open";
}

export function correctionOffset(value: string | undefined | null): number {
  if (value == null || value === "" || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapCorrectionQueueRow(row: Row, email: string | null): CorrectionQueueRow | null {
  const id = text(row.id);
  const orderId = text(row.order_id);
  const status = text(row.status);
  const requestedAt = text(row.created_at);
  if (!id || !orderId || typeof row.request_text !== "string" || !status || !requestedAt) return null;
  if (!STATUSES.includes(status as CorrectionQueueRow["status"])) return null;
  return {
    id,
    orderId,
    email,
    note: row.request_text,
    status: status as CorrectionQueueRow["status"],
    requestedAt,
    fixedAt: text(row.fixed_at),
  };
}

async function rowsIn(
  db: Db,
  table: string,
  columns: string,
  column: string,
  ids: string[],
  failure: string,
): Promise<Row[]> {
  const unique = [...new Set(ids)];
  const rows: Row[] = [];
  for (let index = 0; index < unique.length; index += CHUNK) {
    const slice = unique.slice(index, index + CHUNK);
    const { data, error } = await db.from(table).select(columns).in(column, slice);
    if (error) throw new Error(failure);
    rows.push(...((data ?? []) as unknown as Row[]));
  }
  return rows;
}

async function emailsByOrder(db: Db, orderIds: string[]): Promise<Map<string, string | null>> {
  const failure = "Could not load correction requests.";
  const orders = await rowsIn(db, "orders", "id, customer_id", "id", orderIds, failure);
  const customerIds = orders.flatMap((row) => (typeof row.customer_id === "string" ? [row.customer_id] : []));
  const customers = await rowsIn(db, "customers", "id, email", "id", customerIds, failure);
  const byCustomer = new Map<string, string | null>();
  for (const row of customers) {
    if (typeof row.id === "string") byCustomer.set(row.id, text(row.email));
  }
  const byOrder = new Map<string, string | null>();
  for (const row of orders) {
    if (typeof row.id !== "string") continue;
    const customerId = typeof row.customer_id === "string" ? row.customer_id : "";
    byOrder.set(row.id, byCustomer.get(customerId) ?? null);
  }
  return byOrder;
}

/** Newest request first. One page of `CORRECTION_PAGE_SIZE`. `open` and `fixed` are exact statuses. */
export async function listCorrectionRequests(
  db: Db,
  filter: CorrectionFilter,
  page: { limit: number; offset: number },
): Promise<{ rows: CorrectionQueueRow[]; total: number }> {
  const failure = "Could not load correction requests.";
  let query = db
    .from("order_final_corrections")
    .select("id, order_id, request_text, status, created_at, fixed_at", { count: "exact" });
  query = filter === "all" ? query.in("status", [...STATUSES]) : query.eq("status", filter);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) throw new Error(failure);
  const stored = (data ?? []) as Row[];
  const emails = await emailsByOrder(
    db,
    stored.flatMap((row) => (typeof row.order_id === "string" ? [row.order_id] : [])),
  );
  const rows = stored.flatMap((row) => {
    const orderId = typeof row.order_id === "string" ? row.order_id : "";
    const mapped = mapCorrectionQueueRow(row, emails.get(orderId) ?? null);
    return mapped ? [mapped] : [];
  });
  return { total: typeof count === "number" ? count : page.offset + rows.length, rows };
}

const MOCK_CORRECTIONS: CorrectionQueueRow[] = [
  {
    id: "mock-corr-new",
    orderId: "CP-24790",
    email: "ada@example.com",
    note: "The name on page one is wrong.",
    status: "open",
    requestedAt: "2026-10-23T18:00:00.000Z",
    fixedAt: null,
  },
  {
    id: "mock-corr-claimed",
    orderId: "CP-24802",
    email: "bea@example.com",
    note: "A claim is already in progress.",
    status: "in_progress",
    requestedAt: "2026-10-22T18:00:00.000Z",
    fixedAt: null,
  },
  {
    id: "mock-corr-fixed",
    orderId: "CP-24611",
    email: "ada@example.com",
    note: "The date was corrected.",
    status: "fixed",
    requestedAt: "2026-10-20T18:00:00.000Z",
    fixedAt: "2026-10-21T15:00:00.000Z",
  },
];

async function mockStaffCorrections(
  filter: CorrectionFilter,
  page: { limit: number; offset: number },
): Promise<{ rows: CorrectionQueueRow[]; total: number }> {
  const account = await getAccount();
  if (!account) throw new HttpError("Sign in required", 401);
  if (!account.isAdmin) throw new HttpError("Staff access required", 403);
  const matched = filter === "all" ? MOCK_CORRECTIONS : MOCK_CORRECTIONS.filter((row) => row.status === filter);
  return { total: matched.length, rows: matched.slice(page.offset, page.offset + page.limit) };
}

/** Staff session, then the service-role client from requireStaff. Mock mode never opens that client. */
export async function listStaffCorrections(
  filter: CorrectionFilter,
  page: { limit: number; offset: number },
): Promise<{ rows: CorrectionQueueRow[]; total: number }> {
  if (isMockMode()) return mockStaffCorrections(filter, page);
  const { db } = await requireStaff();
  return listCorrectionRequests(db, filter, page);
}
