import { beforeEach, describe, expect, it, vi } from "vitest";
import * as certification from "./certification";
import * as db from "./db";
import * as email from "./email";
import * as staff from "./staff";
import * as storage from "./storage";
import * as webhooks from "./webhook-delivery";
import { approveOrder } from "./admin";
import { json, run } from "./http";
import type { DeliveryRecord, OrderRecord, PaymentRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const userId = "staff-1";
const staffFinalName = "20261012T081300000Z--staff-1.pdf";
const staffFinalPath = `${orderId}/staff-final/${staffFinalName}`;
const aiFinalPath = `${orderId}/translation-v1.pdf`;

const paidOrder = {
  id: orderId,
  customerId: "customer-1",
  status: "paid",
  targetLanguage: "en",
  finalTranslationPath: staffFinalPath,
  certificationPath: "finals/certification.pdf",
} as OrderRecord;

const pendingDelivery = {
  id: "delivery-1",
  orderId,
  status: "pending",
  finalPath: null,
  certificationPath: null,
  approvedBy: null,
  approvedAt: null,
  deliveredAt: null,
} as DeliveryRecord;

describe("approveOrder cover stamp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: {} as db.Db, userId, role: "admin" });
    vi.spyOn(staff, "ensureStaffRow").mockResolvedValue(undefined);
    vi.spyOn(db, "getOrderById").mockResolvedValue(paidOrder);
    vi.spyOn(db, "settledPayment").mockResolvedValue({ id: "pay-1", status: "paid" } as PaymentRecord);
    vi.spyOn(db, "getDelivery").mockResolvedValue(pendingDelivery);
    vi.spyOn(db, "updateDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "hasEvent").mockResolvedValue(false);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      { filename: "diploma.pdf" } as Awaited<ReturnType<typeof db.listDocuments>>[number],
    ]);
    vi.spyOn(certification, "approverDisplayName").mockResolvedValue("Ada Lovelace");
    vi.spyOn(certification, "stampApprovedCover").mockResolvedValue(undefined);
    vi.spyOn(email, "sendDeliveryReady").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(storage, "listObjectNames").mockResolvedValue([staffFinalName]);
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://files.example/signed");
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
  });

  it("fails the approval and returns the stamp error when the cover restamp throws", async () => {
    vi.spyOn(certification, "stampApprovedCover").mockRejectedValue(
      new Error("ENOENT: no such file or directory, open '/var/task/src/lib/orders/pdf/NotoSans-Italic.ttf'"),
    );

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "ENOENT: no such file or directory, open 'NotoSans-Italic.ttf'",
    });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(db.updateDelivery).not.toHaveBeenCalled();
    expect(email.sendDeliveryReady).not.toHaveBeenCalled();
    expect(db.insertEvent).not.toHaveBeenCalled();
    expect(webhooks.notifyOrder).not.toHaveBeenCalled();
  });

  it("updates status and sends the delivery email only after the stamp succeeds", async () => {
    const steps: string[] = [];
    vi.spyOn(certification, "stampApprovedCover").mockImplementation(async () => {
      steps.push("stamp");
    });
    vi.spyOn(db, "updateOrder").mockImplementation(async () => {
      steps.push("status");
    });
    vi.spyOn(email, "sendDeliveryReady").mockImplementation(async () => {
      steps.push("email");
      return { sent: true, skipped: false };
    });

    const response = await run(async () => json(await approveOrder(orderId)));
    const body = (await response.json()) as { status?: string; email?: string };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "delivered", email: "sent" });
    expect(steps.indexOf("stamp")).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf("stamp")).toBeLessThan(steps.indexOf("status"));
    expect(steps.indexOf("stamp")).toBeLessThan(steps.indexOf("email"));
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, { status: "approved" });
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, { status: "delivered" });
    expect(certification.stampApprovedCover).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ finalTranslationPath: staffFinalPath }),
      "Ada Lovelace",
    );
    expect(db.updateDelivery).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ final_path: staffFinalPath }),
    );
  });

  it("refuses approval and does not stamp the AI file until the staff upload is current", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      ...paidOrder,
      finalTranslationPath: aiFinalPath,
    });

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Upload the reviewed final PDF first" });
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(db.updateDelivery).not.toHaveBeenCalled();
    expect(email.sendDeliveryReady).not.toHaveBeenCalled();
  });
});
