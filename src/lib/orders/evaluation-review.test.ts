import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import * as finalEmail from "./final-email";
import { evaluationPrice } from "./evaluation-price";
import {
  assertEvaluationPdf,
  deliverEvaluationReport,
  evaluationQueueOrder,
  evaluationReleaseBlock,
  missingEvaluationReports,
} from "./evaluation-review";
import * as staff from "./staff";
import * as storage from "./storage";
import type { DeliveryRecord, OrderRecord, PaymentRecord } from "./types";
import * as webhooks from "./webhook-delivery";

const orderId = "28492f38-1111-4111-8111-111111111111";
const userId = "staff-1";
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    customerId: "customer-1",
    status: "paid",
    serviceType: "evaluation",
    orderType: "evaluation",
    service: "diploma",
    degreeCount: 1,
    targetLanguage: "en",
    finalTranslationPath: null,
    certificationPath: null,
    ...patch,
  } as OrderRecord;
}

describe("evaluation price", () => {
  it("uses the diploma and course-by-course fees and never the page rate", () => {
    expect(evaluationPrice({ service: "diploma", degreeCount: 1 })).toEqual({
      unitPriceCents: 1995,
      evaluationCents: 1995,
      translationCents: 0,
      totalCents: 1995,
    });
    expect(evaluationPrice({ service: "course_by_course", degreeCount: 2, addonCents: 100 })).toEqual({
      unitPriceCents: 3995,
      evaluationCents: 7990,
      translationCents: 0,
      totalCents: 8090,
    });
    expect(evaluationPrice({ service: null, degreeCount: null })).toBeNull();
    expect(evaluationPrice({ service: "diploma", degreeCount: 1 })?.unitPriceCents).not.toBe(995);
  });
});

describe("evaluation review queue", () => {
  it("reports elapsed minutes since payment", () => {
    const paidAt = "2026-10-12T00:00:00.000Z";
    const now = Date.parse("2026-10-12T00:14:30.000Z");
    expect(
      evaluationQueueOrder({ id: orderId, service: "course_by_course", email: "ada@example.com", paidAt }, now),
    ).toEqual({
      id: orderId,
      type: "course_by_course",
      services: ["course_by_course"],
      customerEmail: "ada@example.com",
      paidAt,
      waitMinutes: 14,
    });
    expect(evaluationQueueOrder({ id: orderId, service: "diploma", email: null, paidAt: null }, now)).toBeNull();
    expect(evaluationQueueOrder({ id: orderId, service: "diploma", email: null, paidAt: "not-a-date" }, now)).toBeNull();
  });
});

describe("evaluation pdf", () => {
  it("accepts a PDF header and rejects other bytes", () => {
    expect(() => assertEvaluationPdf(pdf)).not.toThrow();
    expect(() => assertEvaluationPdf(new Uint8Array([1, 2, 3, 4]))).toThrow(/PDF/);
    expect(() => assertEvaluationPdf(new Uint8Array())).toThrow(/Empty/);
  });
});

describe("deliverEvaluationReport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: {} as db.Db, userId, role: "admin" });
    vi.spyOn(staff, "ensureStaffRow").mockResolvedValue(undefined);
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "settledPayment").mockResolvedValue({ id: "pay-1", status: "paid" } as PaymentRecord);
    vi.spyOn(db, "getDelivery").mockResolvedValue({
      id: "delivery-1",
      orderId,
      status: "pending",
      finalPath: null,
      certificationPath: null,
      approvedBy: null,
      approvedAt: null,
      deliveredAt: null,
    } as DeliveryRecord);
    vi.spyOn(db, "ensurePendingDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "updateDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "hasEvent").mockResolvedValue(false);
    vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
    vi.spyOn(db, "customerEmail").mockResolvedValue("ada@example.com");
    vi.spyOn(finalEmail, "sendFinalCustomerEmail").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
    vi.spyOn(webhooks, "notifyLifecycle").mockResolvedValue(undefined);
  });

  it("stores the PDF, marks the order delivered, and emails the customer", async () => {
    const body = new FormData();
    body.set("file", new File([pdf], "evaluation.pdf", { type: "application/pdf" }));
    const request = new Request("https://credpronto.com/api/admin/orders/1/evaluation", {
      method: "POST",
      body,
    });

    const result = await deliverEvaluationReport(orderId, request);

    expect(result).toEqual({ status: "delivered", email: "sent" });
    expect(storage.uploadObject).toHaveBeenCalledWith(
      expect.anything(),
      "finals",
      `${orderId}/evaluation.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, {
      status: "delivered",
      final_translation_path: `${orderId}/evaluation.pdf`,
      certification_path: `${orderId}/evaluation.pdf`,
    });
    expect(db.updateDelivery).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ status: "delivered", final_path: `${orderId}/evaluation.pdf` }),
    );
    expect(finalEmail.sendFinalCustomerEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: orderId }),
    );
    expect(webhooks.notifyOrder).toHaveBeenCalledWith(expect.anything(), orderId, "order.delivered");
  });

  it("leaves the report downloadable and retries later when the email fails", async () => {
    vi.spyOn(finalEmail, "sendFinalCustomerEmail").mockResolvedValue({ sent: false, skipped: false });
    const body = new FormData();
    body.set("file", new File([pdf], "evaluation.pdf", { type: "application/pdf" }));

    const result = await deliverEvaluationReport(
      orderId,
      new Request("https://credpronto.com/api/admin/orders/1/evaluation", { method: "POST", body }),
    );

    expect(result).toEqual({ status: "approved", email: "failed" });
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), orderId, { status: "approved" });
    expect(db.updateDelivery).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({ status: "approved", final_path: `${orderId}/evaluation.pdf` }),
    );
    expect(webhooks.notifyOrder).not.toHaveBeenCalled();
  });

  it("rejects a translation order and a file that is not a PDF", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order({ service: null, orderType: "translation" }));
    const pdfBody = new FormData();
    pdfBody.set("file", new File([pdf], "evaluation.pdf", { type: "application/pdf" }));
    await expect(
      deliverEvaluationReport(orderId, new Request("https://credpronto.com", { method: "POST", body: pdfBody })),
    ).rejects.toThrow(/not an evaluation/);

    const text = new FormData();
    text.set("file", new File([new Uint8Array([1, 2, 3, 4])], "notes.txt", { type: "text/plain" }));
    await expect(
      deliverEvaluationReport(orderId, new Request("https://credpronto.com", { method: "POST", body: text })),
    ).rejects.toThrow(/PDF/);
    expect(db.updateOrder).not.toHaveBeenCalled();
  });

  it("keeps each evaluation and delivers only after both reports are stored", async () => {
    const diplomaDoc = await PDFDocument.create();
    diplomaDoc.addPage();
    const diploma = await diplomaDoc.save();
    const courseDoc = await PDFDocument.create();
    courseDoc.addPage();
    const course = await courseDoc.save();
    let current = order({
      service: null,
      services: ["diploma", "course_by_course"],
      degreeCount: 1,
    });
    vi.spyOn(db, "getOrderById").mockImplementation(async () => current);
    vi.spyOn(db, "updateOrder").mockImplementation(async (_client, _id, patch) => {
      if (patch.service_files && typeof patch.service_files === "object") {
        current = { ...current, serviceFiles: patch.service_files as OrderRecord["serviceFiles"] };
      }
      if (typeof patch.status === "string") current = { ...current, status: patch.status as OrderRecord["status"] };
      return true;
    });
    vi.spyOn(storage, "downloadObject").mockImplementation(async (_client, _bucket, path) =>
      path.endsWith("diploma-evaluation.pdf") ? diploma : course,
    );

    const first = new FormData();
    first.set("service", "diploma");
    first.set("file", new File([new Uint8Array(diploma)], "diploma.pdf", { type: "application/pdf" }));
    await expect(
      deliverEvaluationReport(orderId, new Request("https://credpronto.com", { method: "POST", body: first })),
    ).resolves.toEqual({ status: "received", email: "skipped", pending: ["course_by_course"] });
    expect(storage.uploadObject).toHaveBeenCalledWith(
      expect.anything(),
      "finals",
      `${orderId}/diploma-evaluation.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );
    expect(finalEmail.sendFinalCustomerEmail).not.toHaveBeenCalled();

    const second = new FormData();
    second.set("service", "course_by_course");
    second.set("file", new File([new Uint8Array(course)], "course.pdf", { type: "application/pdf" }));
    await expect(
      deliverEvaluationReport(orderId, new Request("https://credpronto.com", { method: "POST", body: second })),
    ).resolves.toEqual({ status: "delivered", email: "sent" });
    expect(storage.uploadObject).toHaveBeenCalledWith(
      expect.anything(),
      "finals",
      `${orderId}/evaluation.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );
  });
});

describe("approve and release: evaluation package gate", () => {
  const base = { id: "9b80cd30-0000-0000-0000-000000000000", service: null, includeTranslation: true };

  it("lists every purchased report that is still missing", () => {
    const order = { ...base, services: ["translation", "diploma", "course_by_course"], serviceFiles: { diploma: "x/diploma-evaluation.pdf" } };
    expect(missingEvaluationReports(order)).toEqual(["course_by_course"]);
    expect(evaluationReleaseBlock(missingEvaluationReports(order))).toMatch(/course-by-course evaluation report/);
  });

  it("refuses a translation+evaluation order with no reports", () => {
    const order = { ...base, services: ["translation", "diploma"], serviceFiles: null };
    expect(missingEvaluationReports(order)).toEqual(["diploma"]);
    expect(evaluationReleaseBlock(["diploma"])).toMatch(/diploma evaluation report/);
  });

  it("allows release once every report is uploaded", () => {
    const order = {
      ...base,
      services: ["translation", "diploma", "course_by_course"],
      serviceFiles: { diploma: "a.pdf", course_by_course: "b.pdf" },
    };
    expect(missingEvaluationReports(order)).toEqual([]);
    expect(evaluationReleaseBlock([])).toBeNull();
  });

  it("treats an already-merged package as present", () => {
    const order = { ...base, services: ["diploma"], serviceFiles: null };
    expect(missingEvaluationReports(order, `${base.id}/evaluation.pdf`)).toEqual([]);
  });

  it("translation-only orders have nothing to gate", () => {
    expect(missingEvaluationReports({ ...base, services: ["translation"] })).toEqual([]);
  });
});
