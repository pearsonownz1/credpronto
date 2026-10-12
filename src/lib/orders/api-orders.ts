import { listPaymentsForOrders, type Db } from "./db";

export type ApiOrderView = {
  id: string;
  externalRef: string | null;
  keyName: string | null;
  keyPrefix: string | null;
  keyLast4: string | null;
  pages: number | null;
  status: string;
  amountCents: number | null;
  currency: string;
  placedAt: string;
  downloadUrl: string | null;
  viewUrl: string | null;
};

/** Settled charge only. A quote that was never paid stays null. */
export function chargedCents(
  payments: Array<{ status: string; amountCents: number; createdAt: string }>,
): number | null {
  const settled = payments.filter((payment) => payment.status === "paid" || payment.status === "paid_test");
  const latest = [...settled].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return latest ? latest.amountCents : null;
}

export function apiOrderView(input: {
  id: string;
  externalRef: string | null;
  pages: number | null;
  status: string;
  currency: string;
  placedAt: string;
  key: { name: string; prefix: string; last4: string } | null;
  payments: Array<{ status: string; amountCents: number; createdAt: string }>;
}): ApiOrderView {
  return {
    id: input.id,
    externalRef: input.externalRef,
    keyName: input.key?.name ?? null,
    keyPrefix: input.key?.prefix ?? null,
    keyLast4: input.key?.last4 ?? null,
    pages: input.pages,
    status: input.status,
    amountCents: chargedCents(input.payments),
    currency: input.currency,
    placedAt: input.placedAt,
    downloadUrl: null,
    viewUrl: null,
  };
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function pages(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function embeddedKey(value: unknown): { name: string; prefix: string; last4: string } | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const record = row as Row;
  const name = text(record.name);
  const prefix = text(record.prefix);
  const last4 = text(record.last4);
  if (!name || !prefix || !last4) return null;
  return { name, prefix, last4 };
}

export async function listApiOrders(db: Db, userId: string): Promise<ApiOrderView[]> {
  const { data, error } = await db
    .from("orders")
    .select("id, external_ref, billable_pages, status, currency, created_at, api_keys(name, prefix, last4)")
    .eq("user_id", userId)
    .not("api_key_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  const payments = await listPaymentsForOrders(
    db,
    rows.map((row) => String(row.id)),
  );
  return rows.map((row) =>
    apiOrderView({
      id: String(row.id),
      externalRef: text(row.external_ref),
      pages: pages(row.billable_pages),
      status: text(row.status) ?? "draft",
      currency: text(row.currency) ?? "usd",
      placedAt: text(row.created_at) ?? new Date(0).toISOString(),
      key: embeddedKey(row.api_keys),
      payments: payments
        .filter((payment) => payment.orderId === String(row.id))
        .map((payment) => ({
          status: payment.status,
          amountCents: payment.amountCents,
          createdAt: payment.createdAt,
        })),
    }),
  );
}
