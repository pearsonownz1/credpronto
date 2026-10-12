import { Suspense } from "react";
import { OrdersBoard } from "@/components/admin/orders-board";
import { listAdminOrders } from "@/lib/api/server";
import { ORDER_STATUSES } from "@/lib/orders/types";

export const instant = false;

export default function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading orders…</p>}>
      <OrdersSearch searchParams={searchParams} />
    </Suspense>
  );
}

async function OrdersSearch({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string }>;
}) {
  const query = await searchParams;
  const status = knownStatus(query.status);
  const offset = clampOffset(query.offset);
  const result = await listAdminOrders({ status, limit: 100, offset });
  if (!result.ok) {
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {result.error}
      </p>
    );
  }
  return (
    <OrdersBoard
      title="Orders"
      lede="Incoming work is still with the customer or the pipeline. Active orders are paid and waiting on staff."
      orders={result.data.orders}
      page={result.data.page}
      status={status}
      mode="split"
    />
  );
}

function knownStatus(value: string | undefined): string | null {
  if (!value) return null;
  return (ORDER_STATUSES as readonly string[]).includes(value) ? value : null;
}

function clampOffset(value: string | undefined): number {
  const offset = Number(value ?? 0);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}
