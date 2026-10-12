"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccountShell } from "@/components/account/account-shell";
import {
  DASHBOARD_TABS,
  formatOrderMoney,
  orderMatches,
  ordersInTab,
  presentOrder,
  previewWaiting,
  type ChipTone,
  type DashboardTab,
  type OrderPresentation,
} from "@/lib/account/present";
import { browserJson, publicMockMode } from "@/lib/api/browser";
import type { CustomerOrder } from "@/lib/api/types";

function openDownload(href: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  anchor.click();
}

const TONE: Record<ChipTone, string> = {
  blue: "bg-[#eaf0ff] text-primary",
  warn: "bg-[#fff4e5] text-[#b45309]",
  neutral: "bg-[#eef0f4] text-[#4b5563]",
  ok: "bg-[#e8f6f0] text-[var(--cp-ok)]",
  violet: "bg-[#f3f0ff] text-[#6d4aff]",
};

export function DashboardView() {
  const { orders, ordersError, query, setQuery, now } = useAccountShell();
  const [tab, setTab] = useState<DashboardTab>("all");
  const [page, setPage] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const waiting = previewWaiting(orders, now);
  const searched = orders.filter((order) => orderMatches(order, query, now));
  const visible = ordersInTab(searched, tab, now);
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = visible.slice(current * pageSize, current * pageSize + pageSize);

  async function download(order: CustomerOrder) {
    const token = order.orderToken;
    if (!token || !order.downloadAvailable) return;
    setDownloadError(null);
    const href = publicMockMode() ? "/samples/birth-certificate-en.pdf" : null;
    if (!href) {
      const result = await browserJson<{ url?: string }>(
        `/api/orders/${encodeURIComponent(token)}/download?file=translation`,
      );
      if (!result.ok || !result.data.url) {
        setDownloadError(result.ok ? "The file is not ready to download." : result.error);
        return;
      }
      openDownload(result.data.url);
      return;
    }
    openDownload(href);
  }

  return (
    <div data-testid="dashboard">
      <div className="mb-[22px] flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] tracking-[-0.6px]">Your orders</h1>
          <p className="mt-1 text-sm text-ink-muted">Every preview, payment and certified file in one place.</p>
        </div>
        <Link
          href="/translate"
          data-testid="new-translation"
          className="inline-flex h-10 items-center justify-center rounded-[var(--cp-radius)] bg-primary px-[18px] text-sm font-semibold text-white"
        >
          + New translation
        </Link>
      </div>
      <div className="mb-[22px] grid gap-3.5 md:grid-cols-3">
        {waiting.length > 0 ? (
          <Link
            href={presentOrder(waiting[0], now).action.href ?? "/dashboard"}
            className="flex items-center gap-3.5 rounded-[var(--cp-radius)] border border-[#c9d6ff] bg-gradient-to-b from-white to-[#f7f9ff] p-[18px]"
          >
            <IconBox>
              <DocGlyph />
            </IconBox>
            <span>
              <span className="block text-[15px] font-semibold">
                {waiting.length} preview{waiting.length === 1 ? "" : "s"} waiting
              </span>
              <span className="mt-0.5 block text-[13px] text-ink-muted">
                {presentOrder(waiting[0], now).documents} · {formatOrderMoney(waiting[0].totalCents)} to buy
              </span>
            </span>
            <span className="ml-auto text-[13px] font-semibold text-primary">Review →</span>
          </Link>
        ) : (
          <div className="flex items-center gap-3.5 rounded-[var(--cp-radius)] border border-line bg-white p-[18px]">
            <IconBox>
              <DocGlyph />
            </IconBox>
            <span>
              <span className="block text-[15px] font-semibold">No preview waiting</span>
              <span className="mt-0.5 block text-[13px] text-ink-muted">A finished preview shows up here.</span>
            </span>
          </div>
        )}
        <Link href="/translate" className="flex items-center gap-3.5 rounded-[var(--cp-radius)] border border-line bg-white p-[18px]">
          <IconBox>
            <UploadGlyph />
          </IconBox>
          <span>
            <span className="block text-[15px] font-semibold">Translate a document</span>
            <span className="mt-0.5 block text-[13px] text-ink-muted">Free preview, from $9.95/page</span>
          </span>
        </Link>
        <Link
          href="/evaluations"
          data-testid="dashboard-evaluation"
          className="flex items-center gap-3.5 rounded-[var(--cp-radius)] border border-line bg-white p-[18px]"
        >
          <IconBox>
            <CapGlyph />
          </IconBox>
          <span>
            <span className="block text-[15px] font-semibold">Credential evaluation</span>
            <span className="mt-0.5 block text-[13px] text-ink-muted">Diploma or course-by-course</span>
          </span>
          <span className="ml-auto text-[13px] font-semibold text-primary">Start →</span>
        </Link>
      </div>
      {ordersError ? (
        <p role="alert" className="mb-3 text-sm text-[#b45309]">
          {ordersError}
        </p>
      ) : null}
      {downloadError ? (
        <p role="alert" className="mb-3 text-sm text-[#b45309]">
          {downloadError}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
        <div className="flex items-center gap-4 overflow-x-auto border-b border-line px-[18px] py-3 text-[13.5px]" role="tablist">
          {DASHBOARD_TABS.map((item) => {
            const count = item.id === "all" ? orders.length : ordersInTab(orders, item.id, now).length;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setTab(item.id);
                  setPage(0);
                }}
                className={`shrink-0 border-b-2 pb-1 ${selected ? "border-ink font-semibold text-ink" : "border-transparent text-ink-muted"}`}
              >
                {item.label}
                <span className="ml-[5px] rounded-lg bg-[#f6f7f9] px-[7px] py-px text-[11px] font-normal">{count}</span>
              </button>
            );
          })}
          <div className="ml-auto hidden md:block">
            <label className="flex h-8 w-[220px] items-center gap-2 rounded-[var(--cp-radius)] border border-line px-2.5 text-[13px] text-ink-muted">
              <span className="sr-only">Search orders</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder="Search…"
                className="w-full bg-transparent outline-none placeholder:text-ink-muted"
              />
            </label>
          </div>
        </div>
        {orders.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <h2 className="text-lg font-semibold">No orders yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
              Upload a document and we will prepare a watermarked preview before you pay.
            </p>
            <Link
              href="/translate"
              className="mt-6 inline-flex h-11 items-center justify-center rounded-[var(--cp-radius)] bg-primary px-5 text-sm font-semibold text-white"
            >
              Get your free preview
            </Link>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-ink-muted">Nothing in this tab yet.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr className="bg-[#fafbfc] text-left text-[12.5px] font-medium text-ink-muted">
                    <th className="px-[18px] py-2.5">Order</th>
                    <th className="px-[18px] py-2.5">Documents</th>
                    <th className="px-[18px] py-2.5">Language</th>
                    <th className="px-[18px] py-2.5">Pages</th>
                    <th className="px-[18px] py-2.5">Status</th>
                    <th className="px-[18px] py-2.5">Placed</th>
                    <th className="px-[18px] py-2.5">Total</th>
                    <th className="px-[18px] py-2.5 text-right">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((order) => {
                    const view = presentOrder(order, now);
                    return (
                      <tr key={order.id} className="border-t border-line" data-testid={`order-${order.id}`}>
                        <td className="px-[18px] py-[13px] font-mono text-[12.5px]">{order.id}</td>
                        <td className="px-[18px] py-[13px] font-semibold">{view.documents}</td>
                        <td className="px-[18px] py-[13px]">{view.pair}</td>
                        <td className="px-[18px] py-[13px]">{view.pages ?? "—"}</td>
                        <td className="px-[18px] py-[13px]">
                          <Chip view={view} />
                        </td>
                        <td className="px-[18px] py-[13px]">{view.placed}</td>
                        <td className="px-[18px] py-[13px]">{view.total}</td>
                        <td className="px-[18px] py-[13px] text-right">
                          <NextStep order={order} view={view} onDownload={download} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((order) => {
                const view = presentOrder(order, now);
                return (
                  <li key={order.id} className="grid gap-2 px-4 py-4" data-testid={`order-card-${order.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[12.5px]">{order.id}</span>
                      <Chip view={view} />
                    </div>
                    <p className="font-semibold">{view.documents}</p>
                    <p className="text-[13px] text-ink-muted">
                      {view.pair} · {view.pages ?? "—"} pages · {view.placed} · {view.total}
                    </p>
                    <div className="text-right">
                      <NextStep order={order} view={view} onDownload={download} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex justify-between border-t border-line px-[18px] py-3 text-[13px] text-ink-muted">
          <span>
            {visible.length} order{visible.length === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-3">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="disabled:opacity-40">
              Previous
            </button>
            <span>
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              disabled={current + 1 >= pages}
              onClick={() => setPage(current + 1)}
              className="disabled:opacity-40"
            >
              Next
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function Chip({ view }: { view: OrderPresentation }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-[9px] py-[3px] text-[12.5px] font-semibold before:size-1.5 before:rounded-full before:bg-current ${TONE[view.chip.tone]}`}>
      {view.chip.label}
    </span>
  );
}

function NextStep({
  order,
  view,
  onDownload,
}: {
  order: CustomerOrder;
  view: OrderPresentation;
  onDownload: (order: CustomerOrder) => void;
}) {
  const { action } = view;
  if ((action.kind === "review" || action.kind === "confirm") && action.href) {
    return (
      <Link
        href={action.href}
        data-emphasis={action.emphasis}
        className={
          action.emphasis === "primary"
            ? "inline-flex items-center rounded-[var(--cp-radius)] bg-primary px-3 py-1.5 text-[13px] font-semibold text-white"
            : "font-semibold text-primary"
        }
      >
        {action.label}
      </Link>
    );
  }
  if (action.kind === "download" && action.href) {
    return (
      <button
        type="button"
        data-emphasis="link"
        className="font-semibold text-primary"
        onClick={() => onDownload(order)}
      >
        {action.label}
      </button>
    );
  }
  if (action.emphasis === "primary") {
    return (
      <span data-emphasis="primary" className="inline-flex items-center rounded-[var(--cp-radius)] bg-primary px-3 py-1.5 text-[13px] font-semibold text-white">
        {action.label}
      </span>
    );
  }
  return <span className="text-ink-muted">{action.label}</span>;
}

function IconBox({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--cp-radius)] bg-[#eaf0ff] text-primary">
      {children}
    </span>
  );
}

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      {children}
    </svg>
  );
}
function DocGlyph() {
  return (
    <Glyph>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 12h7M9 16h5" />
    </Glyph>
  );
}
function UploadGlyph() {
  return (
    <Glyph>
      <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
    </Glyph>
  );
}
function CapGlyph() {
  return (
    <Glyph>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c3 2 9 2 12 0v-5" />
    </Glyph>
  );
}
