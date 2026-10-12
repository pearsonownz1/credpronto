"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { adminBucket, formatOrderDate, formatOrderMoney, inBucket, type AdminBucket } from "@/lib/account/present";
import { languageLabel } from "@/lib/orders/languages";
import { TRANSLATION_TIMEOUT_REASON } from "@/lib/orders/translation-failure";
import { ORDER_STATUSES } from "@/lib/orders/types";
import type { AdminOrder } from "@/lib/api/types";

const BUCKETS: { id: AdminBucket | "split"; label: string }[] = [
  { id: "split", label: "Incoming / active" },
  { id: "incoming", label: "Incoming" },
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
];

export function OrdersBoard({
  title,
  lede,
  orders,
  page,
  status,
  mode,
}: {
  title: string;
  lede: string;
  orders: AdminOrder[];
  page: { limit: number; offset: number; total: number };
  status: string | null;
  mode: "split" | "list";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<AdminBucket | "split">("split");
  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return orders.filter((order) => {
      if (mode === "split" && !status && bucket !== "split" && !inBucket(order.status, bucket)) return false;
      if (!needle) return true;
      return [order.id, order.email, order.status, order.reviewReason, order.sourceLanguage]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [orders, mode, status, bucket, needle]);

  const groups =
    mode === "split" && !status && bucket === "split"
      ? [
          {
            id: "incoming",
            label: "Incoming",
            rows: orders.filter((order) => orderMatches(order, needle) && adminBucket(order.status) === "incoming"),
          },
          {
            id: "active",
            label: "Active",
            rows: orders.filter((order) => orderMatches(order, needle) && adminBucket(order.status) === "active"),
          },
        ]
      : [{ id: "list", label: title, rows: filtered }];

  function visit(next: { status?: string | null; offset?: number }) {
    const params = new URLSearchParams();
    const chosen = next.status === undefined ? status : next.status;
    if (chosen) params.set("status", chosen);
    if (next.offset) params.set("offset", String(next.offset));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const shownFrom = page.total === 0 ? 0 : page.offset + 1;
  const shownTo = page.offset + orders.length;

  return (
    <div data-testid="admin-orders">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] tracking-[-0.6px]">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{lede}</p>
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {mode === "split" ? (
          <div className="flex rounded-[var(--cp-radius)] border border-line bg-white p-0.5 text-sm">
            {BUCKETS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`bucket-${item.id}`}
                aria-pressed={bucket === item.id}
                onClick={() => setBucket(item.id)}
                className={`h-8 rounded-[3px] px-3 ${bucket === item.id ? "bg-[#eaf0ff] font-semibold text-primary" : "text-ink-muted"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {mode === "split" ? (
          <label className="flex h-9 items-center gap-2 rounded-[var(--cp-radius)] border border-line bg-white px-2 text-sm">
            <span className="text-ink-muted">Status</span>
            <select
              aria-label="Status"
              value={status ?? ""}
              onChange={(event) => visit({ status: event.target.value || null, offset: 0 })}
              className="bg-transparent outline-none"
            >
              <option value="">Any</option>
              {ORDER_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {humanStatus(item)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="grid gap-4">
        {groups.map((group) => (
          <section key={group.id} className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
            {groups.length > 1 ? (
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
                {group.label}
                <span className="ml-2 font-normal text-ink-muted">{group.rows.length}</span>
              </h2>
            ) : null}
            {group.rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-muted">No orders in this view.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
                  <thead>
                    <tr className="bg-[#fafbfc] text-left text-[12.5px] text-ink-muted">
                      <th className="px-4 py-2.5 font-medium">Order</th>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 font-medium">Language</th>
                      <th className="px-4 py-2.5 font-medium">Pages</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Placed</th>
                      <th className="px-4 py-2.5 font-medium">Total</th>
                      <th className="px-4 py-2.5 font-medium">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((order) => (
                      <tr key={order.id} data-testid={`admin-order-${order.id}`} className="border-t border-line">
                        <td className="px-4 py-3 font-mono text-[12.5px]">
                          <Link href={`/admin/orders/${order.id}`} className="font-semibold text-primary">
                            {order.id}
                          </Link>
                          {order.expedited ? (
                            <span className="ml-2 rounded bg-[#fff4e5] px-1.5 py-0.5 text-[11px] font-semibold text-[#9a6700]">
                              Expedited
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">{order.email ?? "—"}</td>
                        <td className="px-4 py-3">{order.sourceLanguage ? languageLabel(order.sourceLanguage) : "—"}</td>
                        <td className="px-4 py-3">{order.billablePages ?? "—"}</td>
                        <td className="px-4 py-3">{humanStatus(order.status)}</td>
                        <td className="px-4 py-3">{formatOrderDate(order.createdAt)}</td>
                        <td className="px-4 py-3">{formatOrderMoney(order.totalCents)}</td>
                        <td
                          className={`px-4 py-3 ${order.reviewReason === TRANSLATION_TIMEOUT_REASON ? "font-semibold text-[#9a6700]" : "text-ink-muted"}`}
                        >
                          {order.reviewReason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[13px] text-ink-muted">
        <span>
          {shownFrom}–{shownTo} of {page.total}
        </span>
        <span className="flex gap-3">
          <button
            type="button"
            disabled={page.offset <= 0}
            onClick={() => visit({ offset: Math.max(0, page.offset - page.limit) })}
            className="disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page.offset + orders.length >= page.total}
            onClick={() => visit({ offset: page.offset + page.limit })}
            className="disabled:opacity-40"
          >
            Next
          </button>
        </span>
      </div>
    </div>
  );
}

function orderMatches(order: AdminOrder, needle: string): boolean {
  if (!needle) return true;
  return [order.id, order.email, order.status, order.reviewReason].filter(Boolean).join(" ").toLowerCase().includes(needle);
}

export function humanStatus(status: string): string {
  return status
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
