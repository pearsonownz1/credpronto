import { beforeEach, describe, expect, it, vi } from "vitest";
import { FINALS_BUCKET } from "./constants";
import * as db from "./db";
import { ensurePaidEvaluationReports, regeneratePaidEvaluations } from "./evaluation-dispatch";
import * as evaluation from "./evaluation";
import { HttpError } from "./errors";
import * as pdf from "./pdf/evaluation";
import * as staff from "./staff";
import * as storage from "./storage";
import type { Db } from "./storage";
import type { DocumentRecord, EvaluationResult, EvaluationService, OrderRecord, PageRecord, PaymentRecord } from "./types";
import * as verification from "./verification";

const dbHandle = {} as Db;
const orderId = "5274b9e5-d50d-4cf8-8b47-757922b88431";

function diploma(): EvaluationResult {
  return {
    kind: "diploma",
    credentials: [
      {
        applicant: "Ada Lovelace",
        institution: "Universidad Nacional",
        country: "Mexico",
        credential: "Licenciatura",
        field: "Law",
        dates: "2018",
        usEquivalency: "Bachelor degree",
        documentsReviewed: ["diploma.pdf"],
      },
    ],
  };
}

function course(): EvaluationResult {
  return {
    kind: "course_by_course",
    applicant: "Ada Lovelace",
    institution: "Universidad Nacional",
    country: "Mexico",
    credential: "Licenciatura",
    years: [
      {
        year: "2018",
        courses: [
          {
            originalName: "Derecho",
            englishName: "Law",
            localCredits: 4,
            localGrade: "9",
            usSemesterHours: 3,
            usGrade: "A",
            gradePoints: 12,
          },
        ],
      },
    ],
    totalHours: 120,
    gpa: 3.5,
    gradeScale: "10-point",
  };
}

function bundle(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    customerId: "customer-1",
    userId: null,
    serviceType: "evaluation",
    status: "paid",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 3,
    unitPriceCents: 995,
    totalCents: 8975,
    currency: "usd",
    etaAt: null,
    reviewReason: "Credential evaluation is reviewed by staff.",
    combinedOriginalPath: null,
    finalTranslationPath: `${orderId}/certified-translation-v1.pdf`,
    certificationPath: `${orderId}/certified-translation-v1.pdf`,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "evaluation",
    service: null,
    services: ["translation", "diploma", "course_by_course"],
    serviceFiles: null,
    evaluationResults: null,
    degreeCount: 1,
    evaluationCents: 5990,
    translationCents: 2985,
    includeTranslation: true,
    evaluationResult: null,
    addonCents: 0,
    expedited: false,
    shippingAddress: null,
    mailStatus: null,
    mailTracking: null,
    notarizationStatus: null,
    edgeCredentialId: null,
    edgeGradingScaleId: null,
    edgeMatchMethod: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    paidAt: "2026-10-12T00:05:00.000Z",
    evaluationStatus: "under_review",
    staffAlertSentAt: null,
    staffUrgentAlertSentAt: null,
    progress: { step: "done", pagesRead: 3, pagesTotal: 3 },
    ...patch,
  };
}

function applyPatch(order: OrderRecord, patch: Record<string, unknown>): OrderRecord {
  return {
    ...order,
    evaluationResult: (patch.evaluation_result as EvaluationResult | undefined) ?? order.evaluationResult,
    evaluationResults: (patch.evaluation_results as EvaluationResult[] | undefined) ?? order.evaluationResults,
    serviceFiles: (patch.service_files as OrderRecord["serviceFiles"] | undefined) ?? order.serviceFiles,
  };
}

describe("ensurePaidEvaluationReports", () => {
  let current: OrderRecord;
  const produce = vi.fn(
    async (_db: Db, _order: OrderRecord, service: EvaluationService): Promise<EvaluationResult | null> =>
      service === "diploma" ? diploma() : course(),
  );
  const store = vi.fn(
    async (_db: Db, _order: OrderRecord, service: EvaluationService, result: EvaluationResult) => ({
      result,
      path: `${orderId}/${service}-evaluation.pdf`,
    }),
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    current = bundle();
    produce.mockReset();
    store.mockReset();
    produce.mockImplementation(async (_db, _order, service) => (service === "diploma" ? diploma() : course()));
    store.mockImplementation(async (_db, _order, service, result) => ({
      result,
      path: `${orderId}/${service}-evaluation.pdf`,
    }));
    vi.spyOn(db, "getOrderById").mockImplementation(async () => current);
    vi.spyOn(db, "updateOrder").mockImplementation(async (_db, _id, patch) => {
      current = applyPatch(current, patch);
      return true;
    });
    vi.spyOn(db, "listDocuments").mockResolvedValue([{ id: "doc-1", filename: "diploma.pdf" } as DocumentRecord]);
    vi.spyOn(db, "listPages").mockResolvedValue([
      { id: "page-1", documentId: "doc-1", pageNumber: 1, ocrText: "Licenciatura" } as PageRecord,
    ]);
  });

  it("writes both reports once and leaves them on a second run", async () => {
    const first = await ensurePaidEvaluationReports(dbHandle, orderId, { produce, store });

    expect(first).toEqual({
      status: "ready",
      generated: ["diploma", "course_by_course"],
      pending: [],
      failures: [],
    });
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(db.updateOrder).mock.calls[0]?.[2];
    expect(patch).not.toHaveProperty("total_cents");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("final_translation_path");
    expect(patch?.evaluation_result).toMatchObject({ kind: "diploma" });
    expect(patch?.evaluation_results).toHaveLength(2);
    expect(patch?.service_files).toEqual({
      diploma: `${orderId}/diploma-evaluation.pdf`,
      course_by_course: `${orderId}/course_by_course-evaluation.pdf`,
    });

    const second = await ensurePaidEvaluationReports(dbHandle, orderId, { produce, store });
    expect(second).toEqual({ status: "unchanged", generated: [], pending: [], failures: [] });
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    expect(produce).toHaveBeenCalledTimes(2);
    expect(store).toHaveBeenCalledTimes(2);
  });

  it("saves the diploma when the course result is still missing", async () => {
    produce.mockImplementation(async (_db, _order, service) => (service === "diploma" ? diploma() : null));

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ensurePaidEvaluationReports(dbHandle, orderId, { produce, store });

    expect(result).toEqual({
      status: "partial",
      generated: ["diploma"],
      pending: ["course_by_course"],
      failures: [
        {
          service: "course_by_course",
          reason: "Course-by-course evaluation could not be read from the uploaded pages.",
        },
      ],
    });
    expect(error).toHaveBeenCalled();
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(db.updateOrder).mock.calls[0]?.[2];
    expect(patch?.service_files).toEqual({ diploma: `${orderId}/diploma-evaluation.pdf` });
    expect(patch?.evaluation_results).toHaveLength(1);
  });

  it("builds course-by-course when degree_count was not stored", async () => {
    current = bundle({
      degreeCount: null,
      evaluationCents: 5990,
      translationCents: 2985,
      totalCents: 8975,
      evaluationResult: diploma(),
      serviceFiles: { diploma: `${orderId}/diploma-evaluation.pdf` },
    });

    const result = await ensurePaidEvaluationReports(dbHandle, orderId, { produce, store });

    expect(result).toEqual({
      status: "ready",
      generated: ["course_by_course"],
      pending: [],
      failures: [],
    });
    expect(produce).toHaveBeenCalledTimes(1);
    expect(produce).toHaveBeenCalledWith(
      dbHandle,
      expect.objectContaining({ degreeCount: 1 }),
      "course_by_course",
      expect.any(String),
      ["diploma.pdf"],
    );
    expect(store).toHaveBeenCalledTimes(1);
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.updateOrder).mock.calls[0]?.[2]).not.toHaveProperty("degree_count");
  });

  it("names the reason when the uploaded pages have no text", async () => {
    current = bundle({ degreeCount: null });
    vi.spyOn(db, "listPages").mockResolvedValue([
      { id: "page-1", documentId: "doc-1", pageNumber: 1, ocrText: "   " } as PageRecord,
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await ensurePaidEvaluationReports(dbHandle, orderId, { produce, store });

    expect(result).toEqual({
      status: "partial",
      generated: [],
      pending: ["diploma", "course_by_course"],
      failures: [
        { service: "diploma", reason: "This order has no page text to read for the evaluation." },
        { service: "course_by_course", reason: "This order has no page text to read for the evaluation." },
      ],
    });
    expect(error).toHaveBeenCalledWith("diploma: This order has no page text to read for the evaluation.");
    expect(error).toHaveBeenCalledWith(
      "course_by_course: This order has no page text to read for the evaluation.",
    );
    expect(produce).not.toHaveBeenCalled();
    expect(db.updateOrder).not.toHaveBeenCalled();
  });
});

describe("regeneratePaidEvaluations", () => {
  let current: OrderRecord;

  beforeEach(() => {
    vi.restoreAllMocks();
    current = bundle();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(staff, "requireStaff").mockResolvedValue({ db: dbHandle, userId: "staff-1", role: "admin" });
    vi.spyOn(db, "getOrderById").mockImplementation(async () => current);
    vi.spyOn(db, "updateOrder").mockImplementation(async (_db, _id, patch) => {
      current = applyPatch(current, patch);
      return true;
    });
    vi.spyOn(db, "insertPayment").mockResolvedValue({ id: "pay-new" } as PaymentRecord);
    vi.spyOn(db, "settledPayment").mockResolvedValue({
      id: "pay-1",
      status: "paid",
      paidAt: "2026-10-12T00:05:00.000Z",
    } as PaymentRecord);
    vi.spyOn(db, "listDocuments").mockResolvedValue([{ id: "doc-1", filename: "diploma.pdf" } as DocumentRecord]);
    vi.spyOn(db, "listPages").mockResolvedValue([
      { id: "page-1", documentId: "doc-1", pageNumber: 1, ocrText: "Licenciatura" } as PageRecord,
    ]);
    vi.spyOn(evaluation, "evaluateServiceFromText").mockImplementation(async (_db, _order, service) =>
      service === "diploma" ? diploma() : course(),
    );
    vi.spyOn(pdf, "renderEvaluationPdfs").mockResolvedValue({
      clean: new Uint8Array([1, 2, 3]),
      preview: new Uint8Array([4]),
      pageCount: 1,
    });
    vi.spyOn(verification, "stampFinishedPdf").mockImplementation(async (_db, bytes) => bytes);
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
  });

  it("rejects a caller who is not staff", async () => {
    vi.spyOn(staff, "requireStaff").mockRejectedValue(new HttpError("Staff access required", 403));
    await expect(regeneratePaidEvaluations(orderId)).rejects.toMatchObject({ status: 403 });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(db.insertPayment).not.toHaveBeenCalled();
  });

  it("rejects an unpaid order", async () => {
    current = bundle({ status: "quoted", paidAt: null });
    await expect(regeneratePaidEvaluations(orderId)).rejects.toMatchObject({ status: 409 });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(db.insertPayment).not.toHaveBeenCalled();
  });

  it("rejects a cancelled order", async () => {
    current = bundle({ status: "cancelled" });
    await expect(regeneratePaidEvaluations(orderId)).rejects.toMatchObject({ status: 409 });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(db.insertPayment).not.toHaveBeenCalled();
  });

  it("rejects a translation that has no evaluation", async () => {
    current = bundle({
      orderType: "translation",
      serviceType: "translation",
      service: null,
      services: ["translation"],
      includeTranslation: false,
      degreeCount: null,
    });
    await expect(regeneratePaidEvaluations(orderId)).rejects.toMatchObject({ status: 409 });
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(db.insertPayment).not.toHaveBeenCalled();
  });

  it("stores both missing evaluations and does not charge on a second run", async () => {
    const first = await regeneratePaidEvaluations(orderId);

    expect(first).toEqual({
      status: "ready",
      generated: ["diploma", "course_by_course"],
      pending: [],
      failures: [],
    });
    expect(db.insertPayment).not.toHaveBeenCalled();
    const patch = vi.mocked(db.updateOrder).mock.calls[0]?.[2];
    expect(patch).not.toHaveProperty("total_cents");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("final_translation_path");
    expect(patch?.evaluation_result).toMatchObject({ kind: "diploma" });
    expect(patch?.evaluation_results).toHaveLength(2);
    expect(patch?.service_files).toEqual({
      diploma: `${orderId}/diploma-evaluation.pdf`,
      course_by_course: `${orderId}/course_by_course-evaluation.pdf`,
    });
    expect(storage.uploadObject).toHaveBeenCalledWith(
      dbHandle,
      FINALS_BUCKET,
      `${orderId}/diploma-evaluation.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );
    expect(storage.uploadObject).toHaveBeenCalledWith(
      dbHandle,
      FINALS_BUCKET,
      `${orderId}/course_by_course-evaluation.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );

    const second = await regeneratePaidEvaluations(orderId);
    expect(second).toEqual({ status: "unchanged", generated: [], pending: [], failures: [] });
    expect(db.updateOrder).toHaveBeenCalledTimes(1);
    expect(evaluation.evaluateServiceFromText).toHaveBeenCalledTimes(2);
    expect(db.insertPayment).not.toHaveBeenCalled();
  });
});
