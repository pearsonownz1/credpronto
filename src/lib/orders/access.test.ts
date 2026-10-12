import { describe, expect, it } from "vitest";
import { downloadGate } from "./access";

describe("download gate", () => {
  it("rejects an unpaid order with 402", () => {
    expect(downloadGate({ paymentStatus: null, deliveryStatus: null })).toEqual({
      ok: false,
      status: 402,
      error: "Payment required",
    });
    const pending = downloadGate({ paymentStatus: "pending", deliveryStatus: "pending" });
    expect(pending.ok).toBe(false);
    if (!pending.ok) expect(pending.status).toBe(402);
  });

  it("rejects a paid order whose certification is not approved with 403", () => {
    expect(downloadGate({ paymentStatus: "paid", deliveryStatus: "pending" })).toEqual({
      ok: false,
      status: 403,
      error: "Certification is not approved",
    });
    const unapproved = downloadGate({ paymentStatus: "paid", deliveryStatus: null });
    expect(unapproved.ok).toBe(false);
    if (!unapproved.ok) expect(unapproved.status).toBe(403);
  });

  it("re-locks downloads after a refund even when delivery was approved", () => {
    expect(downloadGate({ paymentStatus: "refunded", deliveryStatus: "approved" })).toEqual({
      ok: false,
      status: 402,
      error: "Payment required",
    });
    expect(downloadGate({ paymentStatus: "refunded", deliveryStatus: "delivered" }).ok).toBe(false);
  });

  it("allows download when payment settled and delivery is approved or delivered", () => {
    expect(downloadGate({ paymentStatus: "paid", deliveryStatus: "approved" })).toEqual({
      ok: true,
    });
    expect(
      downloadGate({ paymentStatus: "paid_test", deliveryStatus: "delivered" }),
    ).toEqual({ ok: true });
  });
});
