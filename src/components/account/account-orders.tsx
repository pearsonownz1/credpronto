import { AccountDownload } from "@/components/account/account-download";
import { signOut } from "@/lib/account/actions";
import { accountRows } from "@/lib/account/order-row";
import type { CustomerOrder } from "@/lib/api/types";
import { Logo } from "@/components/flow/mark";

export function AccountOrders({ orders }: { orders: CustomerOrder[] }) {
  const rows = accountRows(orders);

  return (
    <div className="preview-theme min-h-dvh bg-white text-ink">
      <header className="flex items-center justify-between border-b border-line px-4 py-3 md:px-8">
        <Logo />
        <form action={signOut}>
          <button
            type="submit"
            data-testid="account-sign-out"
            className="text-sm font-semibold text-[#1F5EFF]"
          >
            Sign out
          </button>
        </form>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <h1 className="text-[26px] font-bold tracking-[-0.4px]">Your orders</h1>
        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-ink-muted">No orders yet.</p>
        ) : (
          <ul data-testid="account-orders" className="mt-6 overflow-hidden rounded-[4px] border border-line">
            {rows.map((row) => (
              <li
                key={row.id}
                data-testid={`account-order-${row.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 first:border-t-0"
              >
                <span data-testid={`account-number-${row.id}`} className="font-mono text-[12.5px]">
                  {row.orderNumber}
                </span>
                <span className="min-w-0 flex-1 font-semibold break-words">{row.documentName}</span>
                <span data-testid={`account-status-${row.id}`} className="text-sm text-ink-muted">
                  {row.status}
                </span>
                <span className="text-sm text-ink-muted">{row.date}</span>
                <span data-testid={`account-price-${row.id}`} className="text-sm">
                  {row.price}
                </span>
                {row.downloadFile ? <AccountDownload orderId={row.id} file={row.downloadFile} /> : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
