import { orderPricePaid, shortOrderId } from "./present";

export type AccountOrderStatus = "paid" | "in review" | "ready";

export type AccountRow = {
  id: string;
  /** First eight characters. The row key and links keep the full id. */
  orderNumber: string;
  /** Price from the order's existing cent fields, like $9.95. */
  price: string;
  documentName: string;
  status: AccountOrderStatus;
  date: string;
  downloadFile: "translation" | "evaluation" | null;
};

/** One label for the account list: paid, in review, or ready. */
export function accountOrderStatus(input: {
  status: string;
  paymentStatus: string | null;
  downloadAvailable: boolean;
}): AccountOrderStatus {
  if (input.downloadAvailable) return "ready";
  if (input.paymentStatus === "paid" || input.paymentStatus === "paid_test" || input.status === "paid") {
    return "paid";
  }
  if (input.status === "preview_ready") return "ready";
  return "in review";
}

export function accountOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** One row per order. A repeated id is skipped. */
export function accountRows(
  orders: readonly {
    id: string;
    documentName?: string | null;
    documentsLabel?: string | null;
    status: string;
    paymentStatus: string | null;
    downloadAvailable: boolean;
    createdAt: string;
    serviceType: string;
    totalCents: number | null;
    unitPriceCents?: number | null;
    billablePages?: number | null;
  }[],
): AccountRow[] {
  const seen = new Set<string>();
  const rows: AccountRow[] = [];
  for (const order of orders) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    const name = order.documentName?.trim() || order.documentsLabel?.trim() || "Document";
    rows.push({
      id: order.id,
      orderNumber: shortOrderId(order.id),
      price: orderPricePaid(order),
      documentName: name,
      status: accountOrderStatus(order),
      date: accountOrderDate(order.createdAt),
      downloadFile: order.downloadAvailable
        ? order.serviceType === "evaluation"
          ? "evaluation"
          : "translation"
        : null,
    });
  }
  return rows;
}
