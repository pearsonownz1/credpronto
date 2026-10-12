import { describe, expect, it } from "vitest";
import { activityFor } from "@/lib/account/activity";
import { parseAdminList, parseCustomerOrder, parseCustomerOrders, parseStaffDetail } from "@/lib/api/parse";
import { ORDER_STATUSES } from "@/lib/orders/types";
import { MOCK_CUSTOMER_EMAIL, mockNotes, mockOrdersFor, mockStaffDetail } from "./mock-data";
import {
  GOOGLE_UNAVAILABLE,
  adminBucket,
  formatOrderDate,
  initials,
  messageForGoogleError,
  ordersInTab,
  presentOrder,
  previewWaiting,
} from "./present";

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function order(status: string) {
  return {
    id: status,
    status,
    serviceType: "translation",
    totalCents: 995,
    currency: "usd",
    billablePages: 1,
    unitPriceCents: 995,
    createdAt: "2026-10-11T12:00:00.000Z",
    previewAvailable: status === "preview_ready",
    paymentStatus: null,
    downloadAvailable: status === "delivered",
    orderToken: "tok",
    sourceLanguage: "es",
    documentsLabel: "Diploma",
  };
}

describe("customer order presentation", () => {
  const orders = mockOrdersFor(MOCK_CUSTOMER_EMAIL, NOW);

  it("matches the dashboard comp from the account order shape", () => {
    expect(orders.map((item) => [item.id, presentOrder(item, NOW).chip.label, presentOrder(item, NOW).action.label])).toEqual([
      ["CP-24817", "Preview ready", "Review & buy"],
      ["CP-24815", "Translating · ~6 min", "—"],
      ["CP-24790", "Paid · being certified", "In staff review"],
      ["CP-24702", "Needs your check", "Confirm details"],
      ["CP-24611", "Ready to download", "Download"],
      ["CP-24588", "Ready to download", "Download"],
    ]);
    expect(orders.filter((item) => presentOrder(item, NOW).action.emphasis === "primary")).toHaveLength(1);
    expect(presentOrder(orders[0], NOW).action.href).toBe("/preview/tok-preview-24817");
    expect(ordersInTab(orders, "ready", NOW)).toHaveLength(2);
    expect(previewWaiting(orders, NOW)).toHaveLength(1);
    expect(formatOrderDate("2026-10-11T12:00:00.000Z")).toBe("Oct 11");
    expect(initials("María Ruiz")).toBe("MR");
  });

  it("maps API statuses onto the dashboard tabs and keeps one filled action", () => {
    for (const status of ORDER_STATUSES) {
      const view = presentOrder(order(status), NOW);
      if (view.action.emphasis === "primary") {
        expect(status).toBe("preview_ready");
        expect(view.action.label).toBe("Review & buy");
      }
    }
    expect(presentOrder({ ...order("delivered"), paymentStatus: "refunded", downloadAvailable: false }, NOW).tab).toBe(
      "refunded",
    );
  });

  it("classifies a missing Google provider", () => {
    expect(
      messageForGoogleError({ message: "Unsupported provider: provider is not enabled", code: "validation_failed" }),
    ).toBe(GOOGLE_UNAVAILABLE);
  });

  it("parses the documented me and admin payloads", () => {
    const parsed = parseCustomerOrder({
      id: "ord-1",
      status: "paid",
      serviceType: "translation",
      totalCents: 2985,
      currency: "usd",
      billablePages: 3,
      unitPriceCents: 995,
      createdAt: "2026-10-12T00:00:00.000Z",
      previewAvailable: true,
      paymentStatus: "paid",
      downloadAvailable: false,
    });
    expect(parsed?.billablePages).toBe(3);
    expect(parseCustomerOrders({ orders: [parsed] })).toHaveLength(1);
    expect(presentOrder(parsed!, NOW).documents).toBe("Certified translation");
    expect(presentOrder(parsed!, NOW).pair).toBe("—");

    const list = parseAdminList({
      orders: [
        {
          id: "ord-1",
          status: "needs_review",
          serviceType: "translation",
          sourceLanguage: "es",
          billablePages: 3,
          totalCents: 2985,
          currency: "usd",
          createdAt: "2026-10-12T00:00:00.000Z",
          reviewReason: "low confidence",
          email: "ada@example.com",
        },
      ],
      page: { limit: 50, offset: 0, total: 1 },
    });
    expect(list?.page.total).toBe(1);
    expect(adminBucket("needs_review")).toBe("incoming");
    expect(adminBucket("paid")).toBe("active");
    expect(adminBucket("delivered")).toBe("closed");

    const detail = parseStaffDetail({
      id: "ord-1",
      status: "preview_ready",
      createdAt: "2026-10-12T00:00:00.000Z",
      sourceLanguage: "es",
      targetLanguage: "en",
      email: "ada@example.com",
      documents: [
        {
          id: "doc-1",
          filename: "diploma.pdf",
          pages: [
            {
              id: "page-1",
              pageNumber: 1,
              sourceText: "Diploma",
              translation: { paragraphs: ["Degree"] },
            },
          ],
        },
      ],
      corrections: [],
      payment: null,
      delivery: null,
    });
    expect(detail?.pages[0]?.paragraphs).toEqual(["Degree"]);
    expect(detail?.filename).toBe("diploma.pdf");
    expect(detail?.originalUrl).toBeNull();
    expect(detail?.qa).toBeNull();
  });

  it("keeps a QA report only when the payload includes one", () => {
    const detail = parseStaffDetail({
      id: "ord-2",
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      qa: {
        status: "fail",
        score: 72,
        attempts: 2,
        issues: [
          {
            type: "date",
            severity: "high",
            page: 2,
            original: "14 de marzo de 1994",
            translated: "March 14, 1994",
            note: "Confirm the day-first date.",
          },
          { type: "other", severity: "low", page: 1 },
        ],
      },
    });
    expect(detail?.qa).toEqual({
      status: "fail",
      score: 72,
      attempts: 2,
      issues: [
        {
          type: "date",
          severity: "high",
          page: 2,
          original: "14 de marzo de 1994",
          translated: "March 14, 1994",
          note: "Confirm the day-first date.",
        },
      ],
    });
    expect(parseStaffDetail({
      id: "ord-3",
      status: "paid",
      createdAt: "2026-10-12T00:00:00.000Z",
      qa: { status: "maybe", score: 1, attempts: 1, issues: [] },
    })?.qa).toBeNull();
    expect(mockStaffDetail("CP-24802")?.qa).toBeNull();
    expect(mockStaffDetail("CP-24790")?.qa?.status).toBe("fail");
  });

  it("derives the staff activity log from the detail fields", () => {
    const detail = mockStaffDetail("CP-24790");
    expect(detail).not.toBeNull();
    const labels = activityFor(detail!, mockNotes("CP-24790")).map((item) => item.label);
    expect(labels).toEqual(["Order placed", "Payment received", "Internal note"]);
  });
});
