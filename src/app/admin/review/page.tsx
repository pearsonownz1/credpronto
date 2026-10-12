import { Suspense } from "react";
import { OrdersBoard } from "@/components/admin/orders-board";
import { listAdminOrders } from "@/lib/api/server";
import type { AdminList } from "@/lib/api/types";

const REVIEW_STATUSES = ["needs_review", "correction_requested"] as const;

export default function ReviewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading reviews…</p>}>
      <ReviewList />
    </Suspense>
  );
}

async function ReviewList() {
  const result = await loadStatuses([...REVIEW_STATUSES]);
  if (!result.ok) {
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {result.error}
      </p>
    );
  }
  return (
    <OrdersBoard
      title="Needs review"
      lede="Orders the pipeline could not quote, and customer correction requests."
      orders={result.data.orders}
      page={result.data.page}
      status={null}
      mode="list"
    />
  );
}

async function loadStatuses(statuses: string[]): Promise<{ ok: true; data: AdminList } | { ok: false; error: string }> {
  const results = await Promise.all(statuses.map((status) => listAdminOrders({ status, limit: 100 })));
  const failed = results.find((item) => !item.ok);
  if (failed && !failed.ok) return { ok: false, error: failed.error };
  const orders = results.flatMap((item) => (item.ok ? item.data.orders : []));
  const seen = new Set<string>();
  const unique = orders.filter((order) => {
    if (seen.has(order.id)) return false;
    seen.add(order.id);
    return true;
  });
  const total = results.reduce((sum, item) => sum + (item.ok ? item.data.page.total : 0), 0);
  return { ok: true, data: { orders: unique, page: { limit: 100, offset: 0, total } } };
}
