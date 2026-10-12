import { Suspense } from "react";
import { CertificationQueue } from "@/components/admin/certification-queue";
import { listAdminOrders } from "@/lib/api/server";
import type { AdminOrder } from "@/lib/api/types";
import { certificationQueue } from "@/lib/orders/certification-queue";

const QUEUE_STATUSES = ["paid", "needs_review", "correction_requested"] as const;

export const instant = false;

export default function CertificationPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading certification…</p>}>
      <CertificationList />
    </Suspense>
  );
}

async function CertificationList() {
  const results = await Promise.all(QUEUE_STATUSES.map((status) => listAdminOrders({ status, limit: 100 })));
  const failed = results.find((item) => !item.ok);
  if (failed && !failed.ok) {
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {failed.error}
      </p>
    );
  }
  const orders = certificationQueue(results.flatMap((item) => (item.ok ? item.data.orders : [])));
  return <CertificationQueue orders={orders as AdminOrder[]} />;
}
