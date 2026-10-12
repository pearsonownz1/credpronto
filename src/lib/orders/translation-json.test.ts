import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("runTranslationPage JSON parse", () => {
  const previousFallback = process.env.TRANSLATION_FALLBACK_MODEL;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.TRANSLATION_FALLBACK_MODEL;
    vi.spyOn(jobs, "loadPageWork").mockResolvedValue(work());
    vi.spyOn(jobs, "completePageJob").mockResolvedValue(undefined);
    vi.spyOn(jobs, "failPageJob").mockResolvedValue(undefined);
    vi.spyOn(db, "updateOrder").mockResolvedValue(undefined);
    vi.spyOn(db, "claimOrderColumn").mockResolvedValue(true);
    vi.spyOn(db, "clearOrderColumn").mockResolvedValue(undefined);
    vi.spyOn(email, "sendStaffOrderAlert").mockResolvedValue({ sent: true, skipped: false });
  });

  afterEach(() => {
    if (previousFallback == null) delete process.env.TRANSLATION_FALLBACK_MODEL;
    else process.env.TRANSLATION_FALLBACK_MODEL = previousFallback;
  });

  it("retries unreadable JSON with a stricter prompt and an optional fallback model", async () => {
    process.env.TRANSLATION_FALLBACK_MODEL = "fallback/model";
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed(1));
    const generate = vi
      .spyOn(ai, "generateObject")
      .mockRejectedValueOnce(new Error(jsonFailure))
      .mockResolvedValueOnce({
        pageNumber: 1,
        blocks: [{ type: "paragraph", text: "Birth certificate" }],
      });

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(generate).toHaveBeenCalledTimes(2);
    const first = generate.mock.calls[0] ?? [];
    const second = generate.mock.calls[1] ?? [];
    expect(promptText(first)).not.toContain("Retry rules");
    expect(promptText(second)).toContain("Retry rules");
    expect(promptText(second)).toContain("Do not repeat text inside seals");
    expect(promptText(second)).toMatch(/concise/i);
    expect(first[3]).toEqual({ maxRetries: 0 });
    expect(second[3]).toEqual({ maxRetries: 0, model: "fallback/model" });
    expect(jobs.completePageJob).toHaveBeenCalled();
    expect(jobs.failPageJob).not.toHaveBeenCalled();
    expect(db.updateOrder).not.toHaveBeenCalled();
  });

  it("leaves the order translating when the page job can still retry", async () => {
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed(1));
    vi.spyOn(ai, "generateObject").mockRejectedValue(new Error(jsonFailure));

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(ai.generateObject).toHaveBeenCalledTimes(2);
    expect(jobs.failPageJob).toHaveBeenCalledTimes(1);
    expect(db.updateOrder).not.toHaveBeenCalled();
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
  });

  it("moves a finished page failure to needs_review and alerts staff", async () => {
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed(2));
    vi.spyOn(ai, "generateObject").mockRejectedValue(new Error(jsonFailure));
    vi.spyOn(db, "getOrderById").mockResolvedValue({
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
    } as OrderRecord);

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(ai.generateObject).toHaveBeenCalledTimes(2);
    expect(jobs.failPageJob).toHaveBeenCalledTimes(1);
    expect(db.updateOrder).toHaveBeenCalledWith(
      expect.anything(),
      orderId,
      expect.objectContaining({
        status: "needs_review",
        review_reason: "translation_timeout",
        progress: expect.objectContaining({ step: "done" }),
      }),
    );
    expect(email.sendStaffOrderAlert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining("@")]),
      expect.objectContaining({
        urgent: false,
        orderId,
        sourceLanguage: "es-mx",
        studioUrl: expect.stringContaining(orderId),
      }),
    );
  });
});
