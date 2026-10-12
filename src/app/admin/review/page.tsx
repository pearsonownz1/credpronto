import { Suspense } from "react";
import { OrdersBoard } from "@/components/admin/orders-board";
import { listAdminOrders } from "@/lib/api/server";
import type { AdminList } from "@/lib/api/types";
import {
  EQUIVALENCY_QA_RESEARCH,
  EQUIVALENCY_QA_REVIEW,
  EQUIVALENCY_UNMAPPED,
  onStaffReviewQueue,
} from "@/lib/orders/equivalency";
import { TRANSLATION_TIMEOUT_REASON } from "@/lib/orders/translation-failure";
import { expeditedFirst } from "@/lib/orders/fulfillment";

const REVIEW_STATUSES = ["needs_review", "correction_requested"] as const;

export const instant = false;

export default function ReviewPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading reviews…</p>}>
      <ReviewList />
    </Suspense>
  );
}

async function ReviewList() {
  const [result, flagged, stalled] = await Promise.all([
    loadStatuses([...REVIEW_STATUSES]),
    loadReasons([EQUIVALENCY_UNMAPPED, EQUIVALENCY_QA_REVIEW, EQUIVALENCY_QA_RESEARCH]),
    listAdminOrders({ reviewReason: TRANSLATION_TIMEOUT_REASON, limit: 100 }),
  ]);
  if (!result.ok) {
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {result.error}
      </p>
    );
  }
  if (!flagged.ok) {
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {flagged.error}
      </p>
    );
  }
  if (!stalled.ok) {
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {stalled.error}
      </p>
    );
  }
  const orders = expeditedFirst(
    [...result.data.orders, ...flagged.data.orders, ...stalled.data.orders].filter((order, index, all) => {
      if (!onStaffReviewQueue(order)) return false;
      return all.findIndex((item) => item.id === order.id) === index;
    }),
  );
  return (
    <OrdersBoard
      title="Needs review"
      lede="Orders the pipeline could not finish, including translations that timed out and diploma equivalencies waiting on staff."
      orders={orders}
      page={{ limit: 100, offset: 0, total: orders.length }}
      status={null}
      mode="list"
    />
  );
}

async function loadReasons(reasons: string[]): Promise<{ ok: true; data: AdminList } | { ok: false; error: string }> {
  const results = await Promise.all(reasons.map((reviewReason) => listAdminOrders({ reviewReason, limit: 100 })));
  return mergeLists(results);
}

async function loadStatuses(statuses: string[]): Promise<{ ok: true; data: AdminList } | { ok: false; error: string }> {
  const results = await Promise.all(statuses.map((status) => listAdminOrders({ status, limit: 100 })));
  return mergeLists(results);
}

function mergeLists(
  results: Array<{ ok: true; data: AdminList } | { ok: false; error: string }>,
): { ok: true; data: AdminList } | { ok: false; error: string } {
  const failed = results.find((item) => !item.ok);
  if (failed && !failed.ok) return { ok: false, error: failed.error };
  const orders = results.flatMap((item) => (item.ok ? item.data.orders : []));
  const seen = new Set<string>();
  const unique = expeditedFirst(
    orders.filter((order) => {
      if (seen.has(order.id)) return false;
      seen.add(order.id);
      return true;
    }),
  );
  const total = results.reduce((sum, item) => sum + (item.ok ? item.data.page.total : 0), 0);
  return { ok: true, data: { orders: unique, page: { limit: 100, offset: 0, total } } };
}
