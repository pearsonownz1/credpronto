import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as access from "./admin-access";
import {
  claimFinalCorrectionJob,
  correctedFinalObjectPath,
  correctionListStatus,
  customerFinalPath,
  finalPointerPatch,
  listFinalCorrectionJobs,
  nextFinalVersion,
  parseFinalCorrectionText,
  submitFinalCorrection,
  uploadFixedFinal,
} from "./final-correction";
import * as db from "./db";
import { HttpError } from "./errors";
import * as orderAccess from "./order-access";
import * as storage from "./storage";
import type { Db } from "./storage";
import type { DeliveryRecord, FinalCorrectionRecord, OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const handle = {} as Db;
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    status: "delivered",
    includeTranslation: true,
    finalTranslationPath: `${orderId}/certified-translation-v1.pdf`,
    certificationPath: `${orderId}/certified-translation-v1.pdf`,
    ...patch,
  } as OrderRecord;
}

function delivery(patch: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    id: "delivery-1",
    orderId,
    status: "delivered",
    finalPath: `${orderId}/certified-translation-v1.pdf`,
    certificationPath: `${orderId}/certified-translation-v1.pdf`,
    approvedBy: "staff-1",
    approvedAt: "2026-10-23T12:00:00.000Z",
    deliveredAt: "2026-10-23T12:05:00.000Z",
    ...patch,
  };
}

function correction(patch: Partial<FinalCorrectionRecord> = {}): FinalCorrectionRecord {
  return {
    id: "corr-1",
    orderId,
    text: "The date on the diploma is wrong.",
    status: "open",
    finalPath: null,
    finalVersion: null,
    claimedAt: null,
    fixedAt: null,
    createdAt: "2026-10-23T15:00:00.000Z",
    ...patch,
  };
}

describe("final correction paths", () => {
  it("versions a certified translation without leaving the bundle filename", () => {
    expect(nextFinalVersion(`${orderId}/certified-translation-v1.pdf`)).toBe(2);
    expect(nextFinalVersion(`${orderId}/evaluation.pdf`)).toBe(2);
    expect(correctedFinalObjectPath(orderId, `${orderId}/certified-translation-v1.pdf`, 2)).toBe(
      `${orderId}/certified-translation-v2.pdf`,
    );
    expect(correctedFinalObjectPath(orderId, `${orderId}/evaluation.pdf`, 2)).toBe(
      `${orderId}/corrected-final-v2.pdf`,
    );
  });

  it("follows the path the customer download already reads", () => {
    const current = order();
    expect(customerFinalPath(current, delivery())).toBe(`${orderId}/certified-translation-v1.pdf`);
    expect(
      customerFinalPath(order({ includeTranslation: false, finalTranslationPath: null, certificationPath: null }), delivery()),
    ).toBe(`${orderId}/certified-translation-v1.pdf`);
    expect(customerFinalPath(order({ includeTranslation: false, finalTranslationPath: null, certificationPath: null }), null)).toBeNull();
  });

  it("replaces only columns that point at the previous final", () => {
    const patch = finalPointerPatch(
      order(),
      delivery({ certificationPath: `${orderId}/certification.pdf` }),
      `${orderId}/certified-translation-v1.pdf`,
      `${orderId}/certified-translation-v2.pdf`,
    );
    expect(patch.order).toEqual({
      final_translation_path: `${orderId}/certified-translation-v2.pdf`,
      certification_path: `${orderId}/certified-translation-v2.pdf`,
    });
    expect(patch.delivery).toEqual({ final_path: `${orderId}/certified-translation-v2.pdf` });
    expect(patch.order).not.toHaveProperty("status");
    expect(patch.delivery).not.toHaveProperty("status");
  });

  it("requires the customer's text", () => {
    expect(parseFinalCorrectionText({ text: "  fix the name  " })).toBe("fix the name");
    expect(correctionListStatus(null)).toBe("open");
    expect(correctionListStatus("in_progress")).toBe("in_progress");
    expect(() => parseFinalCorrectionText({})).toThrow(HttpError);
    expect(() => correctionListStatus("fixed")).toThrow(/open or in_progress/);
  });
});

describe("final correction jobs", () => {
  beforeEach(() => {
    vi.spyOn(access, "requireStaffOrService").mockResolvedValue({ db: handle, actor: "service" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits one request and rejects a second", async () => {
    vi.spyOn(orderAccess, "orderForToken").mockResolvedValue({ db: handle, order: order(), token: orderId });
    vi.spyOn(db, "getDelivery").mockResolvedValue(delivery());
    vi.spyOn(db, "getFinalCorrection").mockResolvedValueOnce(null).mockResolvedValueOnce(correction());
    const insert = vi.spyOn(db, "insertFinalCorrection").mockResolvedValue(correction());

    const created = await submitFinalCorrection(orderId, { text: "The date on the diploma is wrong." });
    expect(created).toMatchObject({ status: "open", orderId, text: "The date on the diploma is wrong." });
    await expect(submitFinalCorrection(orderId, { text: "again" })).rejects.toThrow(/already exists/);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("refuses a request when there is no final yet", async () => {
    vi.spyOn(orderAccess, "orderForToken").mockResolvedValue({
      db: handle,
      order: order({ includeTranslation: false, finalTranslationPath: null, certificationPath: null }),
      token: orderId,
    });
    vi.spyOn(db, "getDelivery").mockResolvedValue(null);
    const insert = vi.spyOn(db, "insertFinalCorrection").mockResolvedValue(correction());
    await expect(submitFinalCorrection(orderId, { text: "fix it" })).rejects.toThrow(/final file/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("lists open requests with the source documents and current final paths", async () => {
    vi.spyOn(db, "listFinalCorrectionsByStatus").mockResolvedValue([correction()]);
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      {
        id: "doc-1",
        orderId,
        originalPath: `${orderId}/diploma.pdf`,
        filename: "diploma.pdf",
        mime: "application/pdf",
        size: 10,
        pageCount: 1,
        status: "ready",
        detectedLanguage: "es",
        confidence: 1,
        position: 0,
        appliedPosition: 0,
      },
    ]);
    vi.spyOn(db, "getDelivery").mockResolvedValue(delivery());

    const listed = await listFinalCorrectionJobs(new Request("http://localhost/api/admin/corrections"), null);
    expect(listed.requests).toEqual([
      {
        id: "corr-1",
        orderId,
        text: "The date on the diploma is wrong.",
        status: "open",
        createdAt: "2026-10-23T15:00:00.000Z",
        sourceDocuments: [
          { id: "doc-1", filename: "diploma.pdf", bucket: "originals", path: `${orderId}/diploma.pdf` },
        ],
        finals: {
          bucket: "finals",
          finalTranslationPath: `${orderId}/certified-translation-v1.pdf`,
          certificationPath: `${orderId}/certified-translation-v1.pdf`,
          deliveryFinalPath: `${orderId}/certified-translation-v1.pdf`,
          deliveryCertificationPath: `${orderId}/certified-translation-v1.pdf`,
        },
      },
    ]);
  });

  it("lets only the first claim move open to in_progress", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "getFinalCorrection").mockResolvedValue(correction());
    const claim = vi
      .spyOn(db, "claimFinalCorrection")
      .mockResolvedValueOnce(correction({ status: "in_progress", claimedAt: "2026-10-23T16:00:00.000Z" }))
      .mockResolvedValueOnce(null);

    const request = new Request("http://localhost/api/admin/orders/x/correction/claim", { method: "POST" });
    await expect(claimFinalCorrectionJob(request, orderId)).resolves.toMatchObject({
      status: "in_progress",
      claimedAt: "2026-10-23T16:00:00.000Z",
    });
    await expect(claimFinalCorrectionJob(request, orderId)).rejects.toThrow(/not open/);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("versions the final, marks the request fixed, and leaves delivery status alone", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "getFinalCorrection").mockResolvedValue(correction({ status: "in_progress", claimedAt: "2026-10-23T16:00:00.000Z" }));
    vi.spyOn(db, "getDelivery").mockResolvedValue(delivery());
    const upload = vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    const updateOrder = vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    const updateDelivery = vi.spyOn(db, "updateDelivery").mockResolvedValue(undefined);
    vi.spyOn(db, "markFinalCorrectionFixed").mockResolvedValue(
      correction({
        status: "fixed",
        finalPath: `${orderId}/certified-translation-v2.pdf`,
        finalVersion: 2,
        claimedAt: "2026-10-23T16:00:00.000Z",
        fixedAt: "2026-10-23T16:05:00.000Z",
      }),
    );

    const body = new FormData();
    body.set("file", new File([pdf], "fixed.pdf", { type: "application/pdf" }));
    const request = new Request("http://localhost/api/admin/orders/x/correction/final", { method: "POST", body });
    const result = await uploadFixedFinal(request, orderId);

    expect(result).toMatchObject({
      status: "fixed",
      bucket: "finals",
      finalPath: `${orderId}/certified-translation-v2.pdf`,
      finalVersion: 2,
    });
    expect(upload).toHaveBeenCalledWith(
      handle,
      "finals",
      `${orderId}/certified-translation-v2.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );
    const stored = upload.mock.calls[0]?.[3] as Uint8Array;
    expect(Array.from(stored.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(updateOrder).toHaveBeenCalledWith(handle, orderId, {
      final_translation_path: `${orderId}/certified-translation-v2.pdf`,
      certification_path: `${orderId}/certified-translation-v2.pdf`,
    });
    expect(updateDelivery).toHaveBeenCalledWith(handle, orderId, {
      final_path: `${orderId}/certified-translation-v2.pdf`,
      certification_path: `${orderId}/certified-translation-v2.pdf`,
    });
    expect(updateOrder.mock.calls[0]?.[2]).not.toHaveProperty("status");
    expect(updateDelivery.mock.calls[0]?.[1]).toBe(orderId);
    expect(updateDelivery.mock.calls[0]?.[2]).not.toHaveProperty("status");
  });

  it("does not store a file before the request is claimed", async () => {
    vi.spyOn(db, "getOrderById").mockResolvedValue(order());
    vi.spyOn(db, "getFinalCorrection").mockResolvedValue(correction({ status: "open" }));
    const upload = vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
    const body = new FormData();
    body.set("file", new File([pdf], "fixed.pdf", { type: "application/pdf" }));
    const request = new Request("http://localhost/api/admin/orders/x/correction/final", { method: "POST", body });
    await expect(uploadFixedFinal(request, orderId)).rejects.toThrow(/Claim the correction/);
    expect(upload).not.toHaveBeenCalled();
  });
});
