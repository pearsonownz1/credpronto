import { Suspense } from "react";
import { OrdersBoard } from "@/components/admin/orders-board";
import { listAdminOrders } from "@/lib/api/server";
import type { AdminList } from "@/lib/api/types";

const REFUND_STATUSES = ["paid", "approved", "delivered"] as const;

export const instant = false;

export default function RefundsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading refunds…</p>}>
      <RefundList />
    </Suspense>
  );
}

async function RefundList() {
  const results = await Promise.all(REFUND_STATUSES.map((status) => listAdminOrders({ status, limit: 100 })));
  const failed = results.find((item) => !item.ok);
  if (failed && !failed.ok) {
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {failed.error}
      </p>
    );
  }
  const list = merge(results);
  return (
    <OrdersBoard
      title="Refunds"
      lede="Paid, approved, and delivered orders. The list has no payment status, so open an order to confirm it can be refunded."
      orders={list.orders}
      page={list.page}
      status={null}
      mode="list"
    />
  );
}

function merge(results: Awaited<ReturnType<typeof listAdminOrders>>[]): AdminList {
  const orders = results.flatMap((item) => (item.ok ? item.data.orders : []));
  const total = results.reduce((sum, item) => sum + (item.ok ? item.data.page.total : 0), 0);
  return { orders, page: { limit: 100, offset: 0, total } };
}
