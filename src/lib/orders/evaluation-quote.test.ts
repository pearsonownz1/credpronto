import { beforeEach, describe, expect, it, vi } from "vitest";
import { stampApprovedCover } from "./certification";
import { confirmOrder, patchOrderQuote } from "./customer";
import * as db from "./db";
import { shouldPrepareEvaluationReport, startEvaluationQuote } from "./evaluation";
import * as pipeline from "./pipeline";
import * as storage from "./storage";
import type { OrderRecord } from "./types";
import type { CustomerOrder } from "./view";

const token = "cLhjpSz7HaGJYb94lLxcJnKvKki_G00FSpsQnZu5dm8";

function evaluationOrder(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "evaluation",
    status: "quoted",
    sourceLanguage: "es",
    targetLanguage: "en",
    languageConfirmed: false,
    billablePages: 1,
    unitPriceCents: 995,
    totalCents: 1995,
    currency: "usd",
    etaAt: null,
    reviewReason: null,
    combinedOriginalPath: null,
    finalTranslationPath: "order-1/evaluation-v1.pdf",
    certificationPath: "order-1/evaluation-v1.pdf",
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "evaluation",
    service: "diploma",
    degreeCount: 1,
    evaluationCents: 1995,
    translationCents: 0,
    includeTranslation: false,
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
    progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
    ...patch,
  };
}

const readable = {
  sourceLanguage: "es" as string | null,
  confidence: 0.95,
  billablePages: 1,
  imageQuality: false,
  detectionAvailable: true,
  languagesDisagree: false,
  pageText: "acta de nacimiento",
  filenames: ["birth-certificate.pdf"],
  combinedPath: "order-1/combined.pdf",
  pageOrderBasis: null,
  pageOrder: null,
  token,
};

describe("evaluation quote", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for confirm before preparing the report", () => {
    expect(shouldPrepareEvaluationReport({ service: null, status: "confirmed", languageConfirmed: true })).toBe(
      false,
    );
    expect(shouldPrepareEvaluationReport({ service: "diploma", status: "quoted", languageConfirmed: false })).toBe(
      false,
    );
    expect(shouldPrepareEvaluationReport({ service: "diploma", status: "confirmed", languageConfirmed: true })).toBe(
      true,
    );
    expect(shouldPrepareEvaluationReport({ service: "diploma", status: "processing", languageConfirmed: true })).toBe(
      true,
    );
    expect(
      shouldPrepareEvaluationReport({ service: "diploma", status: "failed", languageConfirmed: true }),
    ).toBe(true);
    expect(
      shouldPrepareEvaluationReport({ service: "diploma", status: "failed", languageConfirmed: false }),
    ).toBe(false);
  });

  it("quotes a Spanish diploma at $19.95 and leaves the report for after confirm", async () => {
    const updates: Record<string, unknown>[] = [];
    vi.spyOn(db, "updateOrder").mockImplementation(async (_client, _id, patch) => {
      updates.push(patch);
    });

    const quoted = await startEvaluationQuote({} as db.Db, evaluationOrder({ status: "draft" }), readable);

    expect(quoted).toEqual({ status: "quoted", totalCents: 1995, billablePages: 1 });
    expect(updates[0]).toMatchObject({
      status: "quoted",
      source_language: "es",
      evaluation_cents: 1995,
      translation_cents: 0,
      include_translation: false,
      total_cents: 1995,
    });
    expect(updates[0]).not.toHaveProperty("final_translation_path");
    expect(updates[0]).not.toHaveProperty("evaluation_result");
  });

  it("adds $9.95 only when translation was already chosen", async () => {
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    const quoted = await startEvaluationQuote(
      {} as db.Db,
      evaluationOrder({ status: "draft", includeTranslation: true }),
      readable,
    );
    expect(quoted.totalCents).toBe(2990);
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        translation_cents: 995,
        include_translation: true,
        total_cents: 2990,
      }),
    );
  });

  it("holds a quote when the language or the scan is not ready", async () => {
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    const blurry = await startEvaluationQuote({} as db.Db, evaluationOrder({ status: "draft" }), {
      ...readable,
      imageQuality: true,
    });
    expect(blurry.status).toBe("needs_review");
    const unsure = await startEvaluationQuote({} as db.Db, evaluationOrder({ status: "draft" }), {
      ...readable,
      confidence: 0.2,
    });
    expect(unsure.status).toBe("needs_review");
    expect(unsure.totalCents).toBe(1995);
  });
});

describe("evaluation confirm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as db.Db);
    vi.spyOn(db, "listDocuments").mockResolvedValue([]);
    vi.spyOn(db, "listPages").mockResolvedValue([]);
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    vi.spyOn(db, "getOrderById").mockImplementation(async () => evaluationOrder());
    vi.spyOn(pipeline, "loadCustomerOrder").mockResolvedValue({ totalCents: 1995 } as CustomerOrder);
  });

  it("confirms at $19.95 when translation stays off and at $29.90 when it is chosen", async () => {
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(evaluationOrder());

    await confirmOrder(token, { sourceLanguage: "es" });
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        status: "confirmed",
        source_language: "es",
        language_confirmed: true,
        evaluation_cents: 1995,
        translation_cents: 0,
        include_translation: false,
        total_cents: 1995,
      }),
    );

    await confirmOrder(token, { sourceLanguage: "Spanish", includeTranslation: true });
    expect(db.updateOrder).toHaveBeenLastCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        translation_cents: 995,
        include_translation: true,
        total_cents: 2990,
      }),
    );
  });

  it("stores credential fields instead of birth-certificate fields", async () => {
    vi.spyOn(db, "listDocuments").mockResolvedValue([
      { id: "doc-1" } as Awaited<ReturnType<typeof db.listDocuments>>[number],
    ]);
    vi.spyOn(db, "confirmFields").mockResolvedValue(undefined);
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(evaluationOrder());

    await confirmOrder(token, {
      sourceLanguage: "es",
      documents: [
        {
          documentId: "doc-1",
          holder_name: "Ada Lovelace",
          school: "Example University",
          degree: "Licence",
          dates_attended: "2018–2022",
          date_awarded: "2022",
        },
      ],
    });

    expect(db.confirmFields).toHaveBeenCalledWith(expect.anything(), "order-1", [
      { documentId: "doc-1", fieldKey: "holder_name", confirmedValue: "Ada Lovelace" },
      { documentId: "doc-1", fieldKey: "school", confirmedValue: "Example University" },
      { documentId: "doc-1", fieldKey: "degree", confirmedValue: "Licence" },
      { documentId: "doc-1", fieldKey: "dates_attended", confirmedValue: "2018–2022" },
      { documentId: "doc-1", fieldKey: "date_awarded", confirmedValue: "2022" },
    ]);
  });

  it("still requires document fields on a translation", async () => {
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(
      evaluationOrder({ service: null, degreeCount: null, orderType: "translation", evaluationCents: null }),
    );
    await expect(confirmOrder(token, { sourceLanguage: "es" })).rejects.toThrow(/every document/);
  });

  it("reprices the quote when the customer opts in", async () => {
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(evaluationOrder());
    await patchOrderQuote(token, { includeTranslation: true });
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      "order-1",
      expect.objectContaining({
        billable_pages: 1,
        translation_cents: 995,
        include_translation: true,
        total_cents: 2990,
      }),
    );
  });

  it("rejects an optional translation on a translation order", async () => {
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue(
      evaluationOrder({ service: null, degreeCount: null, orderType: "translation" }),
    );
    await expect(patchOrderQuote(token, { includeTranslation: false })).rejects.toThrow(/no optional translation/);
  });
});

describe("approved evaluation report", () => {
  it("does not replace the report with a translation certificate", async () => {
    const download = vi.spyOn(storage, "downloadObject").mockResolvedValue(new Uint8Array());
    await stampApprovedCover(
      {} as db.Db,
      evaluationOrder({ status: "paid", sourceLanguage: "es" }),
      "Ada Lovelace",
    );
    expect(download).not.toHaveBeenCalled();
  });
});
