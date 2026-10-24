import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadOrderFile } from "./customer";
import * as db from "./db";
import { HttpError } from "./errors";
import * as evaluation from "./evaluation";
import { gcsEvaluationSourceText, evaluateGcsOrder } from "./gcs-evaluate";
import * as access from "./order-access";
import * as pdf from "./pdf/evaluation";
import * as storage from "./storage";
import type { Db } from "./storage";
import type { DocumentRecord, EvaluationResult, OrderRecord, PageRecord, TranslationRecord } from "./types";
import * as verification from "./verification";

const orderId = "28492f38-1111-4111-8111-111111111111";
const handle = {} as Db;
const clean = new Uint8Array([1, 2, 3]);

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: orderId,
    brand: "gcs",
    status: "preview_ready",
    serviceType: "translation",
    orderType: "translation",
    service: null,
    degreeCount: null,
    targetLanguage: "en",
    billablePages: 2,
    createdAt: "2026-10-12T00:00:00.000Z",
    evaluationResult: null,
    serviceFiles: null,
    ...patch,
  } as OrderRecord;
}

function document(): DocumentRecord {
  return {
    id: "doc-1",
    orderId,
    originalPath: `${orderId}/transcript.pdf`,
    filename: "transcript.pdf",
    mime: "application/pdf",
    size: 100,
    pageCount: 1,
    status: "ready",
    detectedLanguage: "es",
    confidence: 1,
    position: 0,
    appliedPosition: null,
  };
}

function page(ocrText: string | null): PageRecord {
  return {
    id: "page-1",
    documentId: "doc-1",
    pageNumber: 1,
    wordCount: null,
    billableUnits: null,
    billingBasis: null,
    ocrText,
    needsReview: false,
    widthPt: 612,
    heightPt: 792,
    uploadPage: 1,
    logicalPage: null,
    orderHint: null,
    qualityScore: null,
    qualityFlags: [],
    qualityMessage: null,
  };
}

const course: EvaluationResult = {
  kind: "course_by_course",
  applicant: "Ana Ruiz",
  institution: "Universidad",
  country: "Mexico",
  credential: "Licenciatura",
  years: [
    {
      year: "2020",
      courses: [
        {
          originalName: "Matematicas",
          englishName: "Mathematics",
          localCredits: 8,
          localGrade: "9",
          usSemesterHours: 3,
          usGrade: "A",
          gradePoints: 12,
        },
      ],
    },
  ],
  totalHours: 3,
  gpa: 4,
  gradeScale: "10",
};

const emptyCourse: EvaluationResult = { ...course, years: [{ year: "2020", courses: [] }] };

const diploma: EvaluationResult = {
  kind: "diploma",
  credentials: [
    {
      applicant: "Ana Ruiz",
      institution: "Universidad",
      country: "Mexico",
      credential: "Licenciatura",
      field: "Law",
      dates: "2020",
      usEquivalency: "Bachelor's degree",
      documentsReviewed: ["transcript.pdf"],
    },
  ],
};

function built(result: EvaluationResult | null) {
  return {
    result,
    failures: [],
    edgeCredentialId: result ? "edge-1" : null,
    edgeGradingScaleId: result ? "scale-1" : null,
    edgeMatchMethod: result ? ("base" as const) : null,
    route: "qa_research" as const,
  };
}

describe("GCS evaluation text", () => {
  it("uses transcript OCR and falls back to the translation when OCR is empty", () => {
    const documents = [{ id: "doc-1", position: 0 }];
    const rich = "A".repeat(50);
    expect(
      gcsEvaluationSourceText({
        documents,
        pages: [page(rich)],
        translations: [],
      }),
    ).toBe(rich);

    const translated = {
      id: "tr-1",
      documentId: "doc-1",
      version: 1,
      model: null,
      status: "ready",
      output: { pages: [{ paragraphs: ["Bachelor of Arts, awarded 2020."] }] },
    } satisfies TranslationRecord;
    expect(
      gcsEvaluationSourceText({
        documents,
        pages: [page("")],
        translations: [translated],
      }),
    ).toContain("Bachelor of Arts");
  });
});

describe("evaluateGcsOrder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(storage, "uploadObject").mockResolvedValue();
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://signed.example/eval.pdf");
    vi.spyOn(verification, "stampFinishedPdf").mockImplementation(async (_db, bytes) => bytes);
    vi.spyOn(pdf, "renderEvaluationPdfs").mockResolvedValue({ clean, preview: new Uint8Array([9]), pageCount: 1 });
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "listDocuments").mockResolvedValue([document()]);
    vi.spyOn(db, "listPages").mockResolvedValue([page("Course Mathematics grade 9 credits 8")]);
    vi.spyOn(db, "listTranslations").mockResolvedValue([]);
    vi.spyOn(evaluation, "evaluateServiceFromText").mockResolvedValue(built(course));
  });

  it("keeps a course-by-course result that has course rows and stores an unwatermarked PDF", async () => {
    vi.spyOn(access, "orderForToken").mockResolvedValue({ db: handle, order: order(), token: "tok" });

    const payload = await evaluateGcsOrder("tok");

    expect(evaluation.evaluateServiceFromText).toHaveBeenCalledTimes(1);
    expect(evaluation.evaluateServiceFromText).toHaveBeenCalledWith(
      handle,
      expect.objectContaining({ service: "course_by_course", degreeCount: 1, services: ["course_by_course"] }),
      "course_by_course",
      expect.any(String),
      ["transcript.pdf"],
    );
    expect(pdf.renderEvaluationPdfs).toHaveBeenCalledWith(
      course,
      expect.objectContaining({ degreeCount: 1, detectedPages: 2 }),
    );
    expect(verification.stampFinishedPdf).toHaveBeenCalledWith(handle, clean, {
      orderId,
      documentType: "evaluation",
    });
    expect(storage.uploadObject).toHaveBeenCalledWith(
      handle,
      "finals",
      `${orderId}/course_by_course-evaluation.pdf`,
      clean,
      "application/pdf",
    );
    expect(storage.uploadObject).toHaveBeenCalledWith(
      handle,
      "previews",
      `${orderId}/gcs-evaluation-v1.pdf`,
      clean,
      "application/pdf",
    );
    expect(db.updateOrder).toHaveBeenCalledWith(
      handle,
      orderId,
      expect.objectContaining({
        evaluation_result: expect.objectContaining({ kind: "course_by_course", pageCount: 1 }),
        evaluation_results: [expect.objectContaining({ kind: "course_by_course", pageCount: 1 })],
        service_files: { course_by_course: `${orderId}/course_by_course-evaluation.pdf` },
        edge_credential_id: "edge-1",
        edge_grading_scale_id: "scale-1",
        edge_match_method: "base",
      }),
    );
    expect(payload).toEqual({
      evaluation: {
        url: "https://signed.example/eval.pdf",
        pageCount: 1,
        pages: [{ number: 1, widthPt: 612, heightPt: 792 }],
        kind: "course_by_course",
      },
    });
    expect(storage.signedObjectUrl).toHaveBeenCalledWith(
      handle,
      "finals",
      `${orderId}/course_by_course-evaluation.pdf`,
      600,
    );
  });

  it("falls back to a diploma when the transcript has no courses", async () => {
    vi.spyOn(access, "orderForToken").mockResolvedValue({ db: handle, order: order(), token: "tok" });
    vi.mocked(evaluation.evaluateServiceFromText)
      .mockResolvedValueOnce(built(emptyCourse))
      .mockResolvedValueOnce(built(diploma));

    const payload = await evaluateGcsOrder("tok");

    expect(evaluation.evaluateServiceFromText).toHaveBeenNthCalledWith(
      2,
      handle,
      expect.objectContaining({ service: "diploma", degreeCount: 1, services: ["diploma"] }),
      "diploma",
      expect.any(String),
      ["transcript.pdf"],
    );
    expect(payload.evaluation.kind).toBe("diploma");
    expect(db.updateOrder).toHaveBeenCalledWith(
      handle,
      orderId,
      expect.objectContaining({
        service_files: { diploma: `${orderId}/diploma-evaluation.pdf` },
      }),
    );
  });

  it("returns a stored finals file without running the model again", async () => {
    const path = `${orderId}/course_by_course-evaluation.pdf`;
    vi.spyOn(access, "orderForToken").mockResolvedValue({
      db: handle,
      order: order({
        serviceFiles: { diploma: `${orderId}/diploma-evaluation.pdf`, course_by_course: path },
        evaluationResult: { ...course, pageCount: 2 },
      }),
      token: "tok",
    });

    const payload = await evaluateGcsOrder("tok");

    expect(evaluation.evaluateServiceFromText).not.toHaveBeenCalled();
    expect(pdf.renderEvaluationPdfs).not.toHaveBeenCalled();
    expect(payload.evaluation).toMatchObject({
      url: "https://signed.example/eval.pdf",
      pageCount: 2,
      kind: "course_by_course",
    });
    expect(payload.evaluation.pages).toHaveLength(2);
    expect(storage.signedObjectUrl).toHaveBeenCalledWith(handle, "finals", path, 600);
  });

  it("re-renders a stored result when the PDF is missing", async () => {
    vi.spyOn(access, "orderForToken").mockResolvedValue({
      db: handle,
      order: order({ evaluationResult: diploma }),
      token: "tok",
    });

    const payload = await evaluateGcsOrder("tok");

    expect(evaluation.evaluateServiceFromText).not.toHaveBeenCalled();
    expect(pdf.renderEvaluationPdfs).toHaveBeenCalledWith(diploma, expect.any(Object));
    expect(payload.evaluation.kind).toBe("diploma");
  });

  it("rejects an order that is not GCS", async () => {
    vi.spyOn(access, "orderForToken").mockResolvedValue({
      db: handle,
      order: order({ brand: "credpronto" }),
      token: "tok",
    });

    await expect(evaluateGcsOrder("tok")).rejects.toMatchObject({ status: 403 });
    expect(evaluation.evaluateServiceFromText).not.toHaveBeenCalled();
  });

  it("rejects a document with no text", async () => {
    vi.spyOn(access, "orderForToken").mockResolvedValue({ db: handle, order: order(), token: "tok" });
    vi.mocked(db.listPages).mockResolvedValue([page("  ")]);

    await expect(evaluateGcsOrder("tok")).rejects.toBeInstanceOf(HttpError);
    await expect(evaluateGcsOrder("tok")).rejects.toMatchObject({ status: 422 });
    expect(evaluation.evaluateServiceFromText).not.toHaveBeenCalled();
  });
});

describe("GCS evaluation download", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("signs the stored evaluation without a payment", async () => {
    const path = `${orderId}/diploma-evaluation.pdf`;
    vi.spyOn(access, "orderForToken").mockResolvedValue({
      db: handle,
      order: order({ serviceFiles: { diploma: path }, targetLanguage: "en" }),
      token: "tok",
    });
    vi.spyOn(db, "listDocuments").mockResolvedValue([document()]);
    vi.spyOn(db, "settledPayment").mockRejectedValue(new Error("payment should not be checked"));
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://signed.example/download.pdf");
    vi.spyOn(db, "insertEvent").mockResolvedValue();

    const body = await downloadOrderFile("tok", "evaluation");

    expect(db.settledPayment).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      url: "https://signed.example/download.pdf",
      filename: "transcript-evaluation.pdf",
      expiresInSeconds: 300,
    });
    expect(storage.signedObjectUrl).toHaveBeenCalledWith(handle, "finals", path, 300, {
      download: "transcript-evaluation.pdf",
    });
    expect(db.insertEvent).toHaveBeenCalledWith(handle, orderId, "downloaded", { file: "evaluation", brand: "gcs" });
  });
});
