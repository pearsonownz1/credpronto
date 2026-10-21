import { describe, expect, it } from "vitest";
import { accountOrderStatus, accountRows } from "./order-row";

describe("account order rows", () => {
  it("uses paid, in review, and ready", () => {
    expect(accountOrderStatus({ status: "paid", paymentStatus: "paid", downloadAvailable: false })).toBe("paid");
    expect(accountOrderStatus({ status: "needs_review", paymentStatus: null, downloadAvailable: false })).toBe(
      "in review",
    );
    expect(accountOrderStatus({ status: "preview_ready", paymentStatus: null, downloadAvailable: false })).toBe(
      "ready",
    );
    expect(accountOrderStatus({ status: "delivered", paymentStatus: "paid", downloadAvailable: true })).toBe("ready");
  });

  it("lists one row per order with the document name and a download only when the file is done", () => {
    const rows = accountRows([
      {
        id: "order-1",
        documentName: "diploma.pdf",
        status: "delivered",
        paymentStatus: "paid",
        downloadAvailable: true,
        createdAt: "2026-10-11T12:00:00.000Z",
        serviceType: "translation",
        totalCents: 995,
        unitPriceCents: 1990,
      },
      {
        id: "order-1",
        documentName: "duplicate.pdf",
        status: "delivered",
        paymentStatus: "paid",
        downloadAvailable: true,
        createdAt: "2026-10-11T12:00:00.000Z",
        serviceType: "translation",
        totalCents: 995,
      },
      {
        id: "order-2",
        documentsLabel: "Birth certificate",
        status: "processing",
        paymentStatus: null,
        downloadAvailable: false,
        createdAt: "2026-10-10T12:00:00.000Z",
        serviceType: "evaluation",
        totalCents: null,
        unitPriceCents: 995,
        billablePages: null,
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        documentName: "acta.pdf",
        status: "paid",
        paymentStatus: "paid",
        downloadAvailable: false,
        createdAt: "2026-10-09T12:00:00.000Z",
        serviceType: "translation",
        totalCents: 995,
      },
    ]);

    expect(rows).toEqual([
      {
        id: "order-1",
        orderNumber: "order-1",
        price: "$9.95",
        documentName: "diploma.pdf",
        status: "ready",
        date: "Oct 11, 2026",
        downloadFile: "translation",
      },
      {
        id: "order-2",
        orderNumber: "order-2",
        price: "$9.95",
        documentName: "Birth certificate",
        status: "in review",
        date: "Oct 10, 2026",
        downloadFile: null,
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        orderNumber: "11111111",
        price: "$9.95",
        documentName: "acta.pdf",
        status: "paid",
        date: "Oct 9, 2026",
        downloadFile: null,
      },
    ]);
  });

  it("offers the certified translation on a paid bundle while the evaluation is still in review", () => {
    const [row] = accountRows([
      {
        id: "0301d079-8368-40d8-854d-95475933124f",
        documentName: "diploma.pdf",
        status: "paid",
        paymentStatus: "paid",
        downloadAvailable: false,
        createdAt: "2026-10-21T14:25:35.957Z",
        serviceType: "evaluation",
        includeTranslation: true,
        translationReady: true,
        totalCents: 2990,
      },
    ]);
    expect(row?.status).toBe("paid");
    expect(row?.price).toBe("$29.90");
    expect(row?.orderNumber).toBe("0301d079");
    expect(row?.downloadFile).toBe("translation");
  });
});
