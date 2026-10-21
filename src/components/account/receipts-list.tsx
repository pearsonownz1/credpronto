"use client";

import { useAccountShell } from "@/components/account/account-shell";
import { orderPricePaid, receiptOrders, shortOrderId } from "@/lib/account/present";
import { accountOrderDate } from "@/lib/account/order-row";

export function ReceiptsList() {
  const { orders } = useAccountShell();
  const receipts = receiptOrders(orders);

  return (
    <section>
      <h1 className="text-[26px] tracking-[-0.6px]">Receipts</h1>
      {receipts.length === 0 ? (
        <p className="mt-2 max-w-lg text-sm text-ink-muted">Receipts show up here after you pay.</p>
      ) : (
        <ul data-testid="receipts" className="mt-6 overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
          {receipts.map((order) => (
            <li
              key={order.id}
              data-testid={`receipt-${order.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-[18px] py-3 first:border-t-0"
            >
              <span className="font-mono text-[12.5px]">{shortOrderId(order.id)}</span>
              <span className="min-w-0 flex-1 font-semibold">
                {order.documentName?.trim() || order.documentsLabel?.trim() || "Document"}
              </span>
              <span className="text-sm text-ink-muted">{accountOrderDate(order.createdAt)}</span>
              <span data-testid={`receipt-total-${order.id}`} className="text-sm font-semibold">
                Paid {orderPricePaid(order)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
