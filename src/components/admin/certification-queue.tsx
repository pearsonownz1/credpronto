"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WaitingBadge } from "@/components/admin/waiting-badge";
import { humanStatus } from "@/components/admin/orders-board";
import { formatOrderDate, formatOrderMoney } from "@/lib/account/present";
import type { AdminOrder } from "@/lib/api/types";
import { languageLabel } from "@/lib/orders/languages";
import { humanReviewReason } from "@/lib/orders/review-reason";

export function CertificationQueue({ orders, now }: { orders: AdminOrder[]; now?: number }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!needle) return orders;
    return orders.filter((order) =>
      [order.id, order.email, order.status, order.reviewReason, order.sourceLanguage]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [orders, needle]);

  return (
    <div data-testid="certification-queue">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] tracking-[-0.6px]">Certification</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Paid orders that are not approved yet, oldest first. The badge turns red after 15 minutes.
          </p>
        </div>
        <label className="flex h-9 w-full items-center rounded-[var(--cp-radius)] border border-line bg-white px-2.5 text-sm sm:w-64">
          <span className="sr-only">Search orders</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search id or email"
            className="w-full bg-transparent outline-none placeholder:text-ink-muted"
          />
        </label>
      </div>
      <section className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">No paid orders are waiting on certification.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-[#fafbfc] text-left text-[12.5px] text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Language</th>
                  <th className="px-4 py-2.5 font-medium">Pages</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Waiting</th>
                  <th className="px-4 py-2.5 font-medium">Paid</th>
                  <th className="px-4 py-2.5 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id} data-testid={`admin-order-${order.id}`} className="border-t border-line">
                    <td className="px-4 py-3 font-mono text-[12.5px]">
                      <Link href={`/admin/orders/${order.id}`} className="font-semibold text-primary">
                        {order.id}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{order.email ?? "—"}</td>
                    <td className="px-4 py-3">{order.sourceLanguage ? languageLabel(order.sourceLanguage) : "—"}</td>
                    <td className="px-4 py-3">{order.billablePages ?? "—"}</td>
                    <td className="px-4 py-3">{humanStatus(order.status)}</td>
                    <td className="px-4 py-3">
                      <WaitingBadge paidAt={order.paidAt} createdAt={order.createdAt} now={now} />
                    </td>
                    <td className="px-4 py-3">{order.paidAt ? formatOrderDate(order.paidAt) : "—"}</td>
                    <td className="px-4 py-3">
                      {formatOrderMoney(order.totalCents)}
                      {order.reviewReason ? (
                        <span className="mt-0.5 block text-[12px] text-ink-muted">{humanReviewReason(order.reviewReason)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
