import { afterEach, describe, expect, it, vi } from "vitest";
import { readMailing, readNotarization, updateMailing, updateNotarization } from "./admin-fulfillment";
import * as db from "./db";
import { HttpError } from "./errors";
import * as staff from "./staff";
import type { Db } from "./storage";
import type { OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const handle = {} as Db;

const address = {
  name: "Ada Lovelace",
  line1: "2520 Venture Oaks Way",
  line2: null,
  city: "Sacramento",
  state: "CA",
  postalCode: "95833",
  country: "US" as const,
};

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    notarizationStatus: null,
    mailStatus: null,
    mailTracking: null,
    mailCarrier: null,
    mailShippedAt: null,
    shippingAddress: null,
    ...patch,
  } as OrderRecord;
}

function addon(id: "notarization" | "mail") {
  return { id, unitCents: 100, quantity: 1, totalCents: 100 };
}

describe("admin notarization and mailing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function asStaff() {
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: handle, userId: "staff-1", role: "admin" });
  }

  it("reads notarization from the purchased add-on and can set notarized", async () => {
    asStaff();
    vi.spyOn(db, "getOrderById").mockResolvedValue(order({ notarizationStatus: "pending" }));
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([addon("notarization")]);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);

    await expect(readNotarization(orderId)).resolves.toEqual({ needed: true, status: "pending" });
    await expect(updateNotarization(orderId, { status: "notarized" })).resolves.toEqual({
      needed: true,
      status: "notarized",
    });
    expect(update).toHaveBeenCalledWith(handle, orderId, { notarization_status: "notarized" });
    expect(update.mock.calls[0]?.[2]).not.toHaveProperty("status");
  });

  it("does not invent notarization for an order that did not buy it", async () => {
    asStaff();
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([]);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    await expect(readNotarization(orderId)).resolves.toEqual({ needed: false, status: null });
    await expect(updateNotarization(orderId, { status: "done" })).rejects.toThrow(/no notarization/);
    expect(update).not.toHaveBeenCalled();
  });

  it("records carrier, tracking, and the shipped timestamp", async () => {
    asStaff();
    const current = order({ mailStatus: "pending", shippingAddress: address });
    const shippedAt = "2026-10-23T16:00:00.000Z";
    vi.spyOn(db, "getOrderById")
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(
        order({
          mailStatus: "shipped",
          shippingAddress: address,
          mailCarrier: "USPS",
          mailTracking: "9400111899223856927645",
          mailShippedAt: shippedAt,
        }),
      );
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([addon("mail")]);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);

    const result = await updateMailing(orderId, {
      carrier: " USPS ",
      trackingNumber: "9400111899223856927645",
      shipped: true,
      shippedAt,
    });
    expect(result).toEqual({
      needed: true,
      address,
      carrier: "USPS",
      trackingNumber: "9400111899223856927645",
      shipped: true,
      shippedAt,
    });
    expect(update).toHaveBeenCalledWith(handle, orderId, {
      mail_carrier: "USPS",
      mail_tracking: "9400111899223856927645",
      mail_status: "shipped",
      mail_shipped_at: shippedAt,
    });
    expect(update.mock.calls[0]?.[2]).not.toHaveProperty("status");
  });

  it("clears the shipped timestamp when the hard copy is marked unshipped", async () => {
    asStaff();
    vi.spyOn(db, "getOrderById")
      .mockResolvedValueOnce(order({ mailStatus: "shipped", mailShippedAt: "2026-10-23T16:00:00.000Z", shippingAddress: address }))
      .mockResolvedValueOnce(order({ mailStatus: "pending", shippingAddress: address }));
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([addon("mail")]);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    const result = await updateMailing(orderId, { shipped: false });
    expect(result.shipped).toBe(false);
    expect(result.shippedAt).toBeNull();
    expect(update).toHaveBeenCalledWith(handle, orderId, { mail_status: "pending", mail_shipped_at: null });
  });

  it("keeps the checkout address rules and ignores orders without mail", async () => {
    asStaff();
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([]);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    await expect(readMailing(orderId)).resolves.toMatchObject({ needed: false, shipped: false, carrier: null });
    await expect(updateMailing(orderId, { carrier: "UPS" })).rejects.toThrow(/no mail/);
    await expect(updateMailing(orderId, { address: { name: "A" } })).rejects.toBeInstanceOf(HttpError);
    expect(update).not.toHaveBeenCalled();
  });
});
