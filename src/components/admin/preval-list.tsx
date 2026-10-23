import Link from "next/link";
import { formatAdminTimestamp } from "@/lib/admin/format";
import type { PrevalListRow } from "@/lib/admin/preval-queue";

function pageHref(offset: number): string {
  if (offset <= 0) return "/admin/preval";
  return `/admin/preval?offset=${offset}`;
}

export function PrevalList({
  rows,
  page,
}: {
  rows: PrevalListRow[];
  page: { limit: number; offset: number; total: number };
}) {
  const shownFrom = page.total === 0 ? 0 : page.offset + 1;
  const shownTo = page.total === 0 ? 0 : Math.min(page.offset + rows.length, page.total);
  const previous = page.offset > 0 ? pageHref(Math.max(0, page.offset - page.limit)) : null;
  const next = page.offset + rows.length < page.total ? pageHref(page.offset + page.limit) : null;

  return (
    <div data-testid="admin-preval">
      <div className="mb-5">
        <h1 className="text-[26px] tracking-[-0.6px]">Pre-evaluations</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Instant equivalency suggestions, newest first. A paid order is the order stored on the submission when that
          order has a payment status of paid.
        </p>
      </div>
      <section className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted" data-testid="preval-empty">
            No pre-evaluations in this view.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13.5px]">
              <thead>
                <tr className="bg-[#fafbfc] text-left text-[12.5px] text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Result</th>
                  <th className="px-4 py-2.5 font-medium">Paid order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`preval-row-${row.id}`} className="border-t border-line align-top">
                    <td className="px-4 py-3">{row.email ?? "—"}</td>
                    <td className="px-4 py-3">{formatAdminTimestamp(row.createdAt)}</td>
                    <td className="px-4 py-3">{row.summary}</td>
                    <td className="px-4 py-3 font-mono text-[12.5px]">
                      {row.orderId ? (
                        <Link
                          href={`/admin/orders/${row.orderId}`}
                          data-testid={`preval-order-${row.orderId}`}
                          className="font-semibold text-primary"
                        >
                          {row.orderId}
                        </Link>
                      ) : (
                        <span className="font-sans text-ink-muted">Not paid</span>
                      )}
                    </td>
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
            <Link href={previous} data-testid="preval-previous">
              Previous
            </Link>
          ) : (
            <span className="opacity-40">Previous</span>
          )}
          {next ? (
            <Link href={next} data-testid="preval-next">
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
