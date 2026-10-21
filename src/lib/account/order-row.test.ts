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
      },
      {
        id: "order-1",
        documentName: "duplicate.pdf",
        status: "delivered",
        paymentStatus: "paid",
        downloadAvailable: true,
        createdAt: "2026-10-11T12:00:00.000Z",
        serviceType: "translation",
      },
      {
        id: "order-2",
        documentsLabel: "Birth certificate",
        status: "processing",
        paymentStatus: null,
        downloadAvailable: false,
        createdAt: "2026-10-10T12:00:00.000Z",
        serviceType: "evaluation",
      },
    ]);

    expect(rows).toEqual([
      {
        id: "order-1",
        documentName: "diploma.pdf",
        status: "ready",
        date: "Oct 11, 2026",
        downloadFile: "translation",
      },
      {
        id: "order-2",
        documentName: "Birth certificate",
        status: "in review",
        date: "Oct 10, 2026",
        downloadFile: null,
      },
    ]);
  });
});
