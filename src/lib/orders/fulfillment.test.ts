import { describe, expect, it } from "vitest";
import { expeditedFirst, fulfillmentFor, parseTrackingNumber, staffQueueOrder } from "./fulfillment";

const address = {
  name: "Ada Lovelace",
  line1: "2520 Venture Oaks Way",
  line2: "Suite 120",
  city: "Sacramento",
  state: "CA",
  postalCode: "95833",
  country: "US" as const,
};

describe("fulfillment tasks", () => {
  it("hides tasks the order did not purchase", () => {
    expect(
      fulfillmentFor({
        mailStatus: null,
        mailTracking: null,
        shippingAddress: null,
        notarizationStatus: null,
      }),
    ).toEqual({ mail: null, notarization: null });
  });

  it("returns the mailing address and a pending notarization", () => {
    expect(
      fulfillmentFor({
        mailStatus: "pending",
        mailTracking: null,
        shippingAddress: address,
        notarizationStatus: "pending",
      }),
    ).toEqual({
      mail: { status: "pending", trackingNumber: null, carrier: null, shippedAt: null, address },
      notarization: { status: "pending" },
    });
  });

  it("requires a tracking number", () => {
    expect(parseTrackingNumber({ trackingNumber: " 9400111899223856927645 " })).toBe("9400111899223856927645");
    expect(() => parseTrackingNumber({})).toThrow("Tracking number is required");
    expect(() => parseTrackingNumber({ trackingNumber: "   " })).toThrow("Tracking number is required");
  });

  it("sorts expedited orders ahead of newer ones", () => {
    const sorted = expeditedFirst([
      { id: "new", expedited: false, createdAt: "2026-10-11T09:00:00.000Z" },
      { id: "old-rush", expedited: true, createdAt: "2026-10-08T12:00:00.000Z" },
      { id: "newer-rush", expedited: true, createdAt: "2026-10-12T00:00:00.000Z" },
    ]);
    expect(sorted.map((order) => order.id)).toEqual(["newer-rush", "old-rush", "new"]);
  });

  it("sorts the staff queue oldest paid first and uses expedited only as a tiebreak", () => {
    const sorted = staffQueueOrder([
      { id: "new-rush", expedited: true, createdAt: "2026-10-12T00:00:00.000Z", paidAt: "2026-10-12T02:00:00.000Z" },
      { id: "old-plain", expedited: false, createdAt: "2026-10-08T12:00:00.000Z", paidAt: "2026-10-11T09:00:00.000Z" },
      { id: "same-rush", expedited: true, createdAt: "2026-10-11T08:00:00.000Z", paidAt: "2026-10-11T09:00:00.000Z" },
      { id: "unpaid", expedited: true, createdAt: "2026-10-01T00:00:00.000Z", paidAt: null },
    ]);
    expect(sorted.map((order) => order.id)).toEqual(["same-rush", "old-plain", "new-rush", "unpaid"]);
  });
});
