import { describe, expect, it } from "vitest";
import {
  CONFIRMING_PAYMENT_COPY,
  CONFIRMING_PAYMENT_DETAIL,
  QUICK_CHECK_COPY,
  QUICK_CHECK_DETAIL,
} from "@/lib/flow/present";
import { TRANSLATION_REVIEW_COPY } from "@/lib/flow/preview-progress";
import { orderLiveMessage } from "./order-announcement";

const order = {
  status: "quoted" as const,
  billablePages: 2,
  totalCents: 1990,
};

describe("order live message", () => {
  it("says payment is confirming instead of calling a checkout return missing", () => {
    const confirming = `${CONFIRMING_PAYMENT_COPY}. ${CONFIRMING_PAYMENT_DETAIL}`;
    expect(orderLiveMessage({ loading: true, phase: "finalizing", checkout: "success", order: null })).toBe(
      confirming,
    );
    expect(orderLiveMessage({ loading: false, phase: "finalizing", checkout: "success", order })).toBe(
      confirming,
    );
    expect(orderLiveMessage({ loading: false, checkout: "cancel", order: null })).toBe("Payment canceled.");
    expect(
      orderLiveMessage({ loading: false, error: "Order not found", checkout: "success", order: null }),
    ).toBe("We couldn't load this order.");
    expect(
      orderLiveMessage({
        loading: false,
        checkout: "success",
        order: {
          status: "paid",
          billablePages: 1,
          totalCents: 995,
          fulfillment: "awaiting_review",
        },
      }),
    ).toBe(`${QUICK_CHECK_COPY}. ${QUICK_CHECK_DETAIL}`);
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "needs_review",
          billablePages: 1,
          totalCents: 995,
          fulfillment: "awaiting_review",
        },
      }),
    ).toBe(`${QUICK_CHECK_COPY}. ${QUICK_CHECK_DETAIL}`);
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "approved",
          billablePages: 1,
          totalCents: 995,
          fulfillment: "released",
        },
      }),
    ).toBe("Your certified translation is ready.");
  });

  it("says the order is loading until a status arrives", () => {
    expect(orderLiveMessage({ loading: true, order: null })).toBe("Loading your order…");
    expect(orderLiveMessage({ loading: false, error: "Missing", order: null })).toBe(
      "We couldn't load this order.",
    );
  });

  it("announces a quote with the billable page count and price", () => {
    expect(orderLiveMessage({ loading: false, phase: "finalizing", order })).toBe(
      "Quote ready: 2 pages, $19.90",
    );
    expect(orderLiveMessage({ loading: false, phase: "finalizing", order })).not.toContain(
      "Stripe sent you back",
    );
    expect(orderLiveMessage({ loading: false, order })).toBe("Quote ready: 2 pages, $19.90");
    expect(
      orderLiveMessage({
        loading: false,
        order: { status: "quoted", billablePages: 1, totalCents: 995 },
      }),
    ).toBe("Quote ready: 1 page, $9.95");
    expect(
      orderLiveMessage({
        loading: false,
        order: { status: "needs_review", billablePages: 3, totalCents: null },
      }),
    ).toBe("Quote ready: 3 pages");
  });

  it("replaces the loading line when the status is not a quote yet", () => {
    expect(
      orderLiveMessage({
        loading: false,
        order: { status: "draft", billablePages: null, totalCents: null },
      }),
    ).toBe("Reading your files…");
    expect(
      orderLiveMessage({
        loading: false,
        order: { status: "failed", billablePages: 0, totalCents: null },
      }),
    ).toBe("We couldn't read these files.");
    expect(orderLiveMessage({ loading: true, order })).toBe("Quote ready: 2 pages, $19.90");
  });

  it("announces a finished translation step as the preview", () => {
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "processing",
          billablePages: 2,
          totalCents: 1990,
          progress: { step: "done" },
        },
      }),
    ).toBe("Your preview is ready.");
  });

  it("announces translation from the order status", () => {
    expect(
      orderLiveMessage({
        loading: false,
        order: { status: "processing", billablePages: 2, totalCents: 1990 },
      }),
    ).toBe("Translating your document.");
    expect(
      orderLiveMessage({
        loading: false,
        order: { status: "preview_ready", billablePages: 2, totalCents: 1990 },
      }),
    ).toBe("Your preview is ready.");
  });

  it("says a translation is taking longer when the order is delayed", () => {
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "processing",
          billablePages: 2,
          totalCents: 1990,
          delayed: true,
          progress: { step: "translating" },
        },
      }),
    ).toBe("Taking longer than usual, we're on it.");
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "needs_review",
          billablePages: 2,
          totalCents: 1990,
          delayed: true,
          progress: { step: "done" },
        },
      }),
    ).toBe(TRANSLATION_REVIEW_COPY);
    expect(TRANSLATION_REVIEW_COPY).not.toMatch(/\d+\s*(minute|hour)/i);
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "needs_review",
          billablePages: 2,
          totalCents: 1990,
          delayed: false,
          reviewReason: "translation_timeout",
          progress: { step: "done" },
        },
      }),
    ).toBe(TRANSLATION_REVIEW_COPY);
    expect(
      orderLiveMessage({
        loading: false,
        phase: "certifying",
        order: {
          status: "paid",
          billablePages: 1,
          totalCents: 1995,
          fulfillment: "awaiting_review",
          orderType: "evaluation",
          service: "diploma",
        },
      }),
    ).toBe(`${QUICK_CHECK_COPY}. ${QUICK_CHECK_DETAIL}`);
    expect(
      orderLiveMessage({
        loading: false,
        phase: "certifying",
        order: {
          status: "paid",
          billablePages: 1,
          totalCents: 1995,
          fulfillment: "awaiting_review",
          orderType: "evaluation",
          service: "diploma",
          evaluationStatus: "performing_layout",
        },
      }),
    ).toBe(`${QUICK_CHECK_COPY}. ${QUICK_CHECK_DETAIL}`);
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "needs_review",
          billablePages: 2,
          totalCents: 1990,
          delayed: true,
          orderType: "evaluation",
          progress: { step: "done" },
        },
      }),
    ).toBe("Taking longer than usual, we're on it.");
    expect(
      orderLiveMessage({
        loading: false,
        order: {
          status: "needs_review",
          billablePages: 2,
          totalCents: 1990,
          delayed: false,
          progress: { step: "done" },
        },
      }),
    ).toBe("Quote ready: 2 pages, $19.90");
  });
});
