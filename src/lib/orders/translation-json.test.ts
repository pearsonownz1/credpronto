import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "./ai";
import * as db from "./db";
import * as email from "./email";
import type { Db } from "./storage";
import { runTranslationPage } from "./translation";
import * as jobs from "./translation-jobs";
import type { PageJobRecord, PageWork } from "./translation-jobs";
import type { OrderRecord } from "./types";

const orderId = "28492f38-1111-4111-8111-111111111111";
const jobId = "aaaaaaaa-1111-4111-8111-111111111111";
const jsonFailure = "No object generated: could not parse the response (JSON parsing failed)";

function claimed(attempts: number): PageJobRecord {
  return {
    id: jobId,
    orderId,
    version: 1,
    documentId: "bbbbbbbb-1111-4111-8111-111111111111",
    pageId: "cccccccc-1111-4111-8111-111111111111",
    pageNumber: 1,
    combinedPageNumber: 1,
    status: "running",
    attempts,
    output: null,
    error: null,
    updatedAt: "2026-10-12T00:00:00.000Z",
  };
}

function work(): PageWork {
  return {
    job: claimed(1),
    run: {
      orderId,
      version: 1,
      status: "running",
      pageCount: 1,
      round: 0,
      token: null,
      qaIssues: [],
      updatedAt: "2026-10-12T00:00:00.000Z",
    },
    order: {
      id: orderId,
      status: "processing",
      sourceLanguage: "es-mx",
      progress: { step: "translating", pagesRead: 0, pagesTotal: 1 },
      staffAlertSentAt: null,
    } as OrderRecord,
    filename: "acta.pdf",
    page: {
      id: "cccccccc-1111-4111-8111-111111111111",
      documentId: "bbbbbbbb-1111-4111-8111-111111111111",
      pageNumber: 1,
      number: 1,
      wordCount: 12,
      billableUnits: 1,
      billingBasis: "words",
      ocrText: "ACTA DE NACIMIENTO",
      needsReview: false,
      widthPt: null,
      heightPt: null,
      uploadPage: 1,
      logicalPage: 1,
      orderHint: null,
      qualityScore: null,
      qualityFlags: [],
      qualityMessage: null,
    },
    fields: [],
    corrections: [],
    qaIssues: [],
  };
}

function promptText(call: readonly unknown[]): string {
  const messages = call[1] as Array<{ content?: Array<{ text?: string }> }>;
  return messages[0]?.content?.[0]?.text ?? "";
}

function processingOrder(): OrderRecord {
  return {
    id: orderId,
    status: "processing",
    sourceLanguage: "es-mx",
    targetLanguage: "en",
    serviceType: "translation",
    billablePages: 1,
    totalCents: 2495,
    progress: { step: "translating", pagesRead: 0, pagesTotal: 1 },
    staffAlertSentAt: null,
    reviewReason: null,
  } as OrderRecord;
}

describe("runTranslationPage JSON parse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(jobs, "loadPageWork").mockResolvedValue(work());
    vi.spyOn(jobs, "completePageJob").mockResolvedValue(undefined);
    vi.spyOn(jobs, "failPageJob").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "getOrderById").mockResolvedValue(processingOrder());
    vi.spyOn(db, "claimOrderColumn").mockResolvedValue(true);
    vi.spyOn(db, "clearOrderColumn").mockResolvedValue(undefined);
    vi.spyOn(email, "sendStaffOrderAlert").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(email, "sendTranslationFailureAlert").mockResolvedValue({ sent: true, skipped: false });
  });

  it("stores a page that returns once", async () => {
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed(1));
    vi.spyOn(ai, "generateObject").mockResolvedValue({
      pageNumber: 1,
      blocks: [{ type: "paragraph", text: "Birth certificate" }],
    });

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(ai.generateObject).toHaveBeenCalledTimes(1);
    expect(jobs.completePageJob).toHaveBeenCalled();
    expect(jobs.failPageJob).not.toHaveBeenCalled();
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(email.sendTranslationFailureAlert).not.toHaveBeenCalled();
  });

  it("flags needs_review and alerts staff on the first unreadable JSON response", async () => {
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed(1));
    vi.spyOn(ai, "generateObject").mockRejectedValue(new Error(jsonFailure));

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(ai.generateObject).toHaveBeenCalledTimes(1);
    expect(promptText(vi.mocked(ai.generateObject).mock.calls[0] ?? [])).not.toContain("Retry rules");
    expect(jobs.failPageJob).toHaveBeenCalledTimes(1);
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({
        status: "needs_review",
        review_reason: "translation_timeout",
        progress: expect.objectContaining({ step: "done" }),
      }),
      { statuses: ["confirmed", "processing", "correction_requested"] },
    );
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(email.sendTranslationFailureAlert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("@")]),
      {
        orderId,
        reason: "Translation timed out before it could finish.",
        studioUrl: expect.stringContaining(orderId),
      },
    );
  });

  it("flags needs_review and alerts staff on any other page failure", async () => {
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed(1));
    vi.spyOn(ai, "generateObject").mockRejectedValue(new Error("schema mismatch"));

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(jobs.failPageJob).toHaveBeenCalledTimes(1);
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({
        status: "needs_review",
        review_reason: "schema mismatch",
      }),
      { statuses: ["confirmed", "processing", "correction_requested"] },
    );
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(email.sendTranslationFailureAlert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("@")]),
      {
        orderId,
        reason: "schema mismatch",
        studioUrl: expect.stringContaining(orderId),
      },
    );
  });
});
