import { getAccount, isMockMode } from "@/lib/account/session";
import { HttpError } from "@/lib/orders/errors";
import { requireStaff } from "@/lib/orders/staff";
import type { Db } from "@/lib/orders/storage";

export const CORRECTION_FILTERS = ["open", "fixed", "all"] as const;

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

const STATUSES = new Set<CorrectionQueueRow["status"]>(["open", "in_progress", "fixed"]);
const PAGE = 1000;
const CAP = 5000;
const CHUNK = 100;

type Row = Record<string, unknown>;

export function correctionListFilter(value: string | undefined | null): CorrectionFilter {
  if (value === "fixed" || value === "all" || value === "open") return value;
  return "open";
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
  if (!STATUSES.has(status as CorrectionQueueRow["status"])) return null;
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

/** Newest request first. `open` and `fixed` are exact statuses. `all` includes in-progress claims. */
export async function listCorrectionRequests(db: Db, filter: CorrectionFilter): Promise<CorrectionQueueRow[]> {
  const failure = "Could not load correction requests.";
  const stored: Row[] = [];
  let offset = 0;
  for (;;) {
    let query = db
      .from("order_final_corrections")
      .select("id, order_id, request_text, status, created_at, fixed_at");
    if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(failure);
    const page = (data ?? []) as Row[];
    stored.push(...page);
    if (page.length < PAGE || stored.length >= CAP) break;
    offset += PAGE;
  }
  const emails = await emailsByOrder(
    db,
    stored.flatMap((row) => (typeof row.order_id === "string" ? [row.order_id] : [])),
  );
  return stored.flatMap((row) => {
    const orderId = typeof row.order_id === "string" ? row.order_id : "";
    const mapped = mapCorrectionQueueRow(row, emails.get(orderId) ?? null);
    return mapped ? [mapped] : [];
  });
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

async function mockStaffCorrections(filter: CorrectionFilter): Promise<CorrectionQueueRow[]> {
  const account = await getAccount();
  if (!account) throw new HttpError("Sign in required", 401);
  if (!account.isAdmin) throw new HttpError("Staff access required", 403);
  if (filter === "all") return MOCK_CORRECTIONS;
  return MOCK_CORRECTIONS.filter((row) => row.status === filter);
}

/** Staff session, then the service-role client from requireStaff. Mock mode never opens that client. */
export async function listStaffCorrections(filter: CorrectionFilter): Promise<CorrectionQueueRow[]> {
  if (isMockMode()) return mockStaffCorrections(filter);
  const { db } = await requireStaff();
  return listCorrectionRequests(db, filter);
}
