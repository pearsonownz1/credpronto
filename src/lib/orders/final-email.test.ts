import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import * as email from "./email";
import { retryFinalCustomerEmail, sendFinalCustomerEmail } from "./final-email";
import { FINAL_DOWNLOAD_SUBJECT } from "./email-templates";
import type { DeliveryRecord, OrderRecord, PaymentRecord } from "./types";
import * as webhooks from "./webhook-delivery";

const orderId = "28492f38-1111-4111-8111-111111111111";

function order(): OrderRecord {
  return {
    id: orderId,
    customerId: "customer-1",
    service: "diploma",
    degreeCount: 1,
    evaluationCents: 1995,
    translationCents: 0,
    billablePages: null,
    unitPriceCents: 1995,
    totalCents: 1995,
  } as OrderRecord;
}

function delivery(status: DeliveryRecord["status"]): DeliveryRecord {
  return {
    id: "delivery-1",
    orderId,
    status,
    finalPath: `${orderId}/evaluation.pdf`,
    certificationPath: `${orderId}/evaluation.pdf`,
    approvedBy: "staff-1",
    approvedAt: "2026-10-21T00:00:00.000Z",
    deliveredAt: null,
  } as DeliveryRecord;
}

describe("sendFinalCustomerEmail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "settledPayment").mockResolvedValue({ amountCents: 1995 } as PaymentRecord);
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([]);
    vi.spyOn(db, "getDelivery").mockResolvedValue(null);
    vi.spyOn(db, "clearOrderColumn").mockResolvedValue(undefined);
  });

  it("claims the send once and uses the download subject", async () => {
    vi.spyOn(db, "claimOrderColumn").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const send = vi.spyOn(email, "sendFinalDownload").mockResolvedValue({ sent: true, skipped: false });

    await expect(sendFinalCustomerEmail({} as db.Db, order())).resolves.toEqual({ sent: true, skipped: false });
    await expect(sendFinalCustomerEmail({} as db.Db, order())).resolves.toEqual({ sent: false, skipped: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].subject).toBe(FINAL_DOWNLOAD_SUBJECT);
    expect(send.mock.calls[0]?.[1].text).toContain(orderId);
    expect(send.mock.calls[0]?.[1].text).toContain("$19.95");
    expect(db.clearOrderColumn).not.toHaveBeenCalled();
  });

  it("releases the claim when the provider rejects the message", async () => {
    vi.spyOn(db, "claimOrderColumn").mockResolvedValue(true);
    vi.spyOn(email, "sendFinalDownload").mockResolvedValue({ sent: false, skipped: false, detail: "rejected" });

    await expect(sendFinalCustomerEmail({} as db.Db, order())).resolves.toMatchObject({ sent: false, skipped: false });
    expect(db.clearOrderColumn).toHaveBeenCalledWith(expect.anything(), orderId, "delivery_email_sent_at", expect.any(String));
  });
});

describe("retryFinalCustomerEmail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "claimOrderColumn").mockResolvedValue(true);
    vi.spyOn(db, "settledPayment").mockResolvedValue({ amountCents: 1995 } as PaymentRecord);
    vi.spyOn(db, "listOrderAddons").mockResolvedValue([]);
    vi.spyOn(db, "getDelivery").mockResolvedValue(delivery("approved"));
    vi.spyOn(db, "updateDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(email, "sendFinalDownload").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyLifecycle").mockResolvedValue(undefined);
  });

  it("finishes an approved order after the download email goes out", async () => {
    await retryFinalCustomerEmail({} as db.Db, order());

    expect(db.updateDelivery).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ status: "delivered" }),
    );
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, { status: "delivered" });
    expect(webhooks.notifyLifecycle).toHaveBeenCalledWith(expect.anything(), orderId, "order.completed");
  });
});
