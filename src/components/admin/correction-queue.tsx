import Link from "next/link";
import { formatAdminTimestamp } from "@/lib/admin/format";
import type { CorrectionFilter, CorrectionQueueRow } from "@/lib/admin/correction-queue";

const FILTERS: Array<{ id: CorrectionFilter; label: string; href: string }> = [
  { id: "open", label: "Open", href: "/admin/corrections" },
  { id: "fixed", label: "Fixed", href: "/admin/corrections?status=fixed" },
  { id: "all", label: "All", href: "/admin/corrections?status=all" },
];

function pageHref(filter: CorrectionFilter, offset: number): string {
  const params = new URLSearchParams();
  if (filter !== "open") params.set("status", filter);
  if (offset > 0) params.set("offset", String(offset));
  const query = params.toString();
  return query ? `/admin/corrections?${query}` : "/admin/corrections";
}

function statusLabel(status: CorrectionQueueRow["status"]): string {
  if (status === "in_progress") return "In progress";
  if (status === "fixed") return "Fixed";
  return "Open";
}

export function CorrectionQueue({
  filter,
  rows,
  page,
}: {
  filter: CorrectionFilter;
  rows: CorrectionQueueRow[];
  page: { limit: number; offset: number; total: number };
}) {
  const shownFrom = page.total === 0 ? 0 : page.offset + 1;
  const shownTo = page.total === 0 ? 0 : Math.min(page.offset + rows.length, page.total);
  const previous = page.offset > 0 ? pageHref(filter, Math.max(0, page.offset - page.limit)) : null;
  const next = page.offset + rows.length < page.total ? pageHref(filter, page.offset + page.limit) : null;

  return (
    <div data-testid="admin-corrections">
      <div className="mb-5">
        <h1 className="text-[26px] tracking-[-0.6px]">Corrections</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Customer requests to fix a delivered file. Open is the default. All includes requests already claimed.
        </p>
      </div>
      <div className="mb-3 flex rounded-[var(--cp-radius)] border border-line bg-white p-0.5 text-sm w-fit">
        {FILTERS.map((item) => {
          const active = filter === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              data-testid={`correction-filter-${item.id}`}
              className={`h-8 rounded-[3px] px-3 leading-8 ${active ? "bg-[#eaf0ff] font-semibold text-primary" : "text-ink-muted"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <section className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted" data-testid="corrections-empty">
            No correction requests in this view.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-[#fafbfc] text-left text-[12.5px] text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Note</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Requested</th>
                  <th className="px-4 py-2.5 font-medium">Fixed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`correction-row-${row.id}`} className="border-t border-line align-top">
                    <td className="px-4 py-3 font-mono text-[12.5px]">
                      <Link href={`/admin/orders/${row.orderId}`} className="font-semibold text-primary">
                        {row.orderId}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{row.email ?? "—"}</td>
                    <td className="max-w-md px-4 py-3 whitespace-pre-wrap break-words">{row.note}</td>
                    <td className="px-4 py-3">{statusLabel(row.status)}</td>
                    <td className="px-4 py-3">{formatAdminTimestamp(row.requestedAt)}</td>
                    <td className="px-4 py-3">{formatAdminTimestamp(row.fixedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="mt-3 flex items-center justify-between text-[13px] text-ink-muted">
        <span>
          {shownFrom}–{shownTo} of {page.total}
        </span>
        <span className="flex gap-3">
          {previous ? (
            <Link href={previous} data-testid="corrections-previous">
              Previous
            </Link>
          ) : (
            <span className="opacity-40">Previous</span>
          )}
          {next ? (
            <Link href={next} data-testid="corrections-next">
              Next
            </Link>
          ) : (
            <span className="opacity-40">Next</span>
          )}
        </span>
      </div>
    </div>
  );
}
