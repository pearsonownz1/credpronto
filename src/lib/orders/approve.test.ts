import { beforeEach, describe, expect, it, vi } from "vitest";
import * as certification from "./certification";
import * as db from "./db";
import * as finalEmail from "./final-email";
import * as staff from "./staff";
import * as storage from "./storage";
import * as verification from "./verification";
import * as webhooks from "./webhook-delivery";
import { approveOrder } from "./admin";
import { EMPTY_TRANSLATION_MESSAGE } from "./translation-edit";
import { json, run } from "./http";
import type { DeliveryRecord, OrderRecord, PaymentRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const userId = "staff-1";

const paidOrder = {
  id: orderId,
  customerId: "customer-1",
  status: "paid",
  targetLanguage: "en",
  finalTranslationPath: "finals/translation.pdf",
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
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(db, "hasEvent").mockResolvedValue(false);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      { id: "doc-1", filename: "diploma.pdf" } as Awaited<ReturnType<typeof db.listDocuments>>[number],
    ]);
    vi.spyOn(db, "listPages").mockResolvedValue([
      { id: "page-1", documentId: "doc-1", pageNumber: 1 } as Awaited<ReturnType<typeof db.listPages>>[number],
    ]);
    vi.spyOn(db, "listTranslations").mockResolvedValue([
      {
        id: "tr-1",
        documentId: "doc-1",
        version: 1,
        model: "test",
        status: "ready",
        output: { pages: [{ pageNumber: 1, paragraphs: ["Certified translation"] }] },
      },
    ]);
    vi.spyOn(certification, "approverDisplayName").mockResolvedValue("Ada Lovelace");
    vi.spyOn(certification, "stampApprovedCover").mockResolvedValue(undefined);
    vi.spyOn(verification, "stampFinishedPdf").mockImplementation(async (_db, bytes) => bytes);
    vi.spyOn(finalEmail, "sendFinalCustomerEmail").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://files.example/signed");
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyLifecycle").mockResolvedValue(undefined);
  });

  it("refuses to release a translation with no text", async () => {
    vi.spyOn(db, "listTranslations").mockResolvedValue([
      {
        id: "tr-1",
        documentId: "doc-1",
        version: 1,
        model: "test",
        status: "ready",
        output: { pages: [{ pageNumber: 1, paragraphs: ["  "] }] },
      },
    ]);

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: EMPTY_TRANSLATION_MESSAGE });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
  });

  it("refuses to release an evaluation order while a purchased report is missing", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue({ ...paidOrder, service: "diploma" });
    vi.spyOn(db, "listTranslations").mockResolvedValue([]);

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Upload the diploma evaluation report before releasing this order",
    });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
  });

  it("refuses translation + diploma + course-by-course with only one report uploaded", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      ...paidOrder,
      service: null,
      services: ["translation", "diploma", "course_by_course"],
      includeTranslation: true,
      serviceFiles: { diploma: `${orderId}/diploma-evaluation.pdf` },
    } as OrderRecord);

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Upload the course-by-course evaluation report before releasing this order",
    });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
  });

  it("releases the whole package (translation + both reports) once every report is uploaded", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const onePage = async () => {
      const doc = await PDFDocument.create();
      doc.addPage();
      return doc.save();
    };
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      ...paidOrder,
      service: null,
      services: ["translation", "diploma", "course_by_course"],
      includeTranslation: true,
      finalTranslationPath: `${orderId}/certified-translation.pdf`,
      certificationPath: `${orderId}/certified-translation.pdf`,
      serviceFiles: {
        diploma: `${orderId}/diploma-evaluation.pdf`,
        course_by_course: `${orderId}/course_by_course-evaluation.pdf`,
      },
    } as OrderRecord);
    vi.spyOn(db, "ensurePendingDelivery").mockResolvedValue(undefined as never);
    const download = vi.spyOn(storage, "downloadObject").mockImplementation(async () => onePage());
    const upload = vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined as never);

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(200);
    expect(download).toHaveBeenCalledTimes(2);
    expect(verification.stampFinishedPdf).toHaveBeenCalledWith(expect.anything(), expect.any(Uint8Array), {
      orderId,
      documentType: "evaluation",
    });
    expect(upload).toHaveBeenCalledWith(expect.anything(), expect.anything(), `${orderId}/evaluation.pdf`, expect.any(Uint8Array), "application/pdf");
    expect(db.updateDelivery).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ status: "delivered", final_path: `${orderId}/evaluation.pdf` }),
    );
    expect(finalEmail.sendFinalCustomerEmail).toHaveBeenCalledTimes(1);
  });

  it("stamps evaluation_complete on an already-delivered evaluation without sending another email", async () => {
    const deliveredAt = "2026-10-22T12:00:00.000Z";
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      ...paidOrder,
      status: "delivered",
      service: "diploma",
      evaluationStatus: "under_review",
    });
    vi.spyOn(db, "getDelivery").mockResolvedValue({
      ...pendingDelivery,
      status: "delivered",
      finalPath: "finals/diploma-evaluation.pdf",
      certificationPath: "finals/diploma-evaluation.pdf",
      deliveredAt,
    });

    const response = await run(async () => json(await approveOrder(orderId)));
    const body = (await response.json()) as { status?: string; email?: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("delivered");
    expect(body.email).toBeUndefined();
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, {
      evaluation_status: "evaluation_complete",
      evaluation_complete_at: deliveredAt,
      review_reason: null,
    });
    expect(db.updateDelivery).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
    expect(webhooks.notifyOrder).not.toHaveBeenCalled();
    expect(webhooks.notifyLifecycle).not.toHaveBeenCalled();
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
  });

  it("refuses an unpaid order", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue({ ...paidOrder, status: "preview_ready" });

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Only a paid order can be certified" });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
  });

  it("refuses a paid order that has no settled payment", async () => {
    vi.spyOn(db, "settledPayment").mockResolvedValue(null);

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({ error: "Payment required" });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
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
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
    expect(db.insertEvent).not.toHaveBeenCalled();
    expect(webhooks.notifyOrder).not.toHaveBeenCalled();
    expect(webhooks.notifyLifecycle).not.toHaveBeenCalled();
  });

  it("updates status and sends the delivery email only after the stamp succeeds", async () => {
    const steps: string[] = [];
    vi.spyOn(certification, "stampApprovedCover").mockImplementation(async () => {
      steps.push("stamp");
    });
    vi.spyOn(db, "updateOrder").mockImplementation(async () => {
      steps.push("status");
      return true;
    });
    vi.spyOn(finalEmail, "sendFinalCustomerEmail").mockImplementation(async () => {
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
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, {
      status: "delivered",
      review_reason: null,
    });
    expect(webhooks.notifyLifecycle).toHaveBeenCalledWith(expect.anything(), orderId, "order.completed");
  });

  it("clears a leftover review reason when approve repairs an already delivered order", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      ...paidOrder,
      status: "delivered",
      service: "diploma",
      reviewReason: "Credential evaluation is reviewed by staff.",
    });
    vi.spyOn(db, "getDelivery").mockResolvedValue({
      ...pendingDelivery,
      status: "delivered",
      finalPath: `${orderId}/evaluation.pdf`,
      certificationPath: `${orderId}/evaluation.pdf`,
    });

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "delivered" });
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({
        evaluation_status: "evaluation_complete",
        review_reason: null,
      }),
    );
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();
  });

  it("clears a leftover review reason when the delivery row is already delivered", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue({
      ...paidOrder,
      status: "approved",
      reviewReason: "Credential evaluation is reviewed by staff.",
    });
    vi.spyOn(db, "getDelivery").mockResolvedValue({
      ...pendingDelivery,
      status: "delivered",
      finalPath: paidOrder.finalTranslationPath,
      certificationPath: paidOrder.certificationPath,
    });

    const response = await run(async () => json(await approveOrder(orderId)));

    expect(response.status).toBe(200);
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, { review_reason: null });
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    expect(certification.stampApprovedCover).not.toHaveBeenCalled();
  });
});
