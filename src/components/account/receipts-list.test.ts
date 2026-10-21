import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CustomerOrder } from "@/lib/api/types";

const shell = vi.hoisted(() => ({
  orders: [] as CustomerOrder[],
}));

vi.mock("@/components/account/account-shell", () => ({
  useAccountShell: () => ({
    orders: shell.orders,
    ordersError: null,
    query: "",
    setQuery: () => undefined,
    now: Date.parse("2026-10-21T14:25:35.957Z"),
    account: { name: "Ada Lovelace", email: "ada@example.com" },
  }),
}));

import { ReceiptsList } from "./receipts-list";

function order(patch: Partial<CustomerOrder>): CustomerOrder {
  return {
    id: "0301d079-8368-40d8-854d-95475933124f",
    status: "paid",
    serviceType: "evaluation",
    totalCents: 2990,
    currency: "usd",
    billablePages: 1,
    unitPriceCents: 995,
    createdAt: "2026-10-21T14:25:35.957Z",
    previewAvailable: true,
    paymentStatus: "paid",
    downloadAvailable: false,
    includeTranslation: true,
    translationReady: true,
    documentName: "diploma.pdf",
    ...patch,
  };
}

describe("receipts", () => {
  it("lists a paid bundle and skips an unpaid preview", () => {
    shell.orders = [order({}), order({ id: "preview-1", status: "preview_ready", paymentStatus: null, serviceType: "translation", includeTranslation: false, documentName: "acta.pdf" })];
    const html = renderToStaticMarkup(createElement(ReceiptsList));
    expect(html).toContain('data-testid="receipt-0301d079-8368-40d8-854d-95475933124f"');
    expect(html).toContain("0301d079");
    expect(html).toContain("Paid $29.90");
    expect(html).toContain("diploma.pdf");
    expect(html).not.toContain("receipt-preview-1");
    expect(html).not.toContain("after you pay for a translation");
  });

  it("stays empty until something is paid", () => {
    shell.orders = [order({ status: "preview_ready", paymentStatus: null, serviceType: "translation", includeTranslation: false })];
    const html = renderToStaticMarkup(createElement(ReceiptsList));
    expect(html).toContain("Receipts show up here after you pay.");
    expect(html).not.toContain('data-testid="receipts"');
  });
});
