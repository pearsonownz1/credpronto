import { describe, expect, it } from "vitest";
import { orderLiveMessage } from "./order-announcement";

const order = {
  status: "quoted" as const,
  billablePages: 2,
  totalCents: 1990,
};

describe("order live message", () => {
  it("says the order is loading until a status arrives", () => {
    expect(orderLiveMessage({ loading: true, order: null })).toBe("Loading your order…");
    expect(orderLiveMessage({ loading: false, error: "Missing", order: null })).toBe(
      "We couldn't load this order.",
    );
  });

  it("announces a quote with the billable page count and price", () => {
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

  it("says a delayed translation is taking longer than usual", () => {
    expect(
      orderLiveMessage({
        loading: false,
        order: { status: "processing", billablePages: 2, totalCents: 1990, delayed: true },
      }),
    ).toBe("Taking longer than usual, we're on it.");
  });
});
