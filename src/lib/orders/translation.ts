import { generateObject, translationFallbackModelId, translationModelId } from "./ai";
import { inReadingOrder } from "./page-order";
import { CONFIRMATION_FIELD_KEYS } from "./fields";
import type { RenderBlock, RenderPage } from "./pdf/layout";
import { coverClientName, coverDocuments, coverSignature, coverTranslatorName, loadTranslatorSignature } from "./pdf/cover";
import { renderOrderPdfs } from "./pdf/render";
import { blocksFromModel, blocksToParagraphs } from "./pdf/structure";
import {
  claimOrderColumn,
  clearOrderColumn,
  customerEmail,
  getOrderById,
  insertEvent,
  insertQaRun,
  insertTranslation,
  latestReadyPreview,
  listConfirmations,
  listCorrections,
  listDocuments,
  listPages,
  markPreview,
  resolveCorrections,
  updateOrder,
  withCombinedNumbers,
  type Db,
} from "./db";
import { adminStudioLink, sendPreviewReady, sendTranslationFailureAlert } from "./email";
import { AiUnavailableError, HttpError } from "./errors";
import { humanReviewReason } from "./review-reason";
import { QA_REVIEW_REASON, assessTranslation, qaAttemptForRound, qaStatusForRun, qaWillRetry, type QaIssue } from "./qa";
import {
  TRANSLATION_DEADLINE_MS,
  TRANSLATION_PAGE_DEADLINE_MS,
  canRetryFailedTranslation,
  TRANSLATION_TIMEOUT_REASON,
  decideTranslationFailure,
  isTemporaryTranslationError,
  isUnreadableModelOutput,
  raceWorkAgainstDeadline,
} from "./translation-failure";
import { OPEN_TRANSLATION_STATUSES, checkedProgress } from "./translation-watch";
import {
  beginTranslation,
  claimAssemble,
  claimPageJob,
  completePageJob,
  failPageJob,
  failTranslationOrder,
  findOpenRun,
  getTranslationRun,
  listPageJobs,
  loadOrderPages,
  loadPageWork,
  markRunFailed,
  markRunReady,
  resumeTranslation,
  type PageJobOutput,
} from "./translation-jobs";
import { isSkippedTranslationPage, pageAttemptResult, passThroughBlocks } from "./translation-pages";
import { staffAlertRecipients } from "./release-decision";
import { uploadObject } from "./storage";
import {
  translationBlockRules,
  translationDocumentSchema,
  translationGenerateOptions,
  translationPageSchema,
  type TranslationPageOutput,
} from "./translation-output";
import type { ConfirmationRecord, CorrectionRecord, PageRecord } from "./types";

type ModelPage = TranslationPageOutput;

function pageHasContent(blocks: RenderBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === "paragraph" || block.type === "note" || block.type === "heading") return block.text.trim().length > 0;
    if (block.type === "fields") return block.rows.some((row) => row.label.trim() || row.value.trim());
    return true;
  });
}

function confirmedBlock(fields: ConfirmationRecord[]): string {
  return CONFIRMATION_FIELD_KEYS.map((key) => {
    const field = fields.find((item) => item.fieldKey === key);
    const value = field?.confirmedValue?.trim() ?? "";
    return `${key}: ${value || "(not on this document)"}`;
  }).join("\n");
}

function dateFormatOf(fields: ConfirmationRecord[]): string {
  const format = fields.find((field) => field.fieldKey === "date_format")?.confirmedValue?.trim();
  return format || "MM/DD/YYYY";
}

function alignPages(expected: number[], returned: ModelPage[]): Array<{ pageNumber: number; blocks: RenderBlock[] }> | null {
  const byNumber = new Map<number, RenderBlock[]>();
  for (const page of returned) {
    const blocks = blocksFromModel(page);
    if (pageHasContent(blocks)) byNumber.set(Math.round(page.pageNumber), blocks);
  }
  if (expected.every((number) => byNumber.has(number))) {
    return expected.map((number) => ({ pageNumber: number, blocks: byNumber.get(number) ?? [] }));
  }
  if (returned.length === expected.length && returned.every((page) => pageHasContent(blocksFromModel(page)))) {
    return expected.map((number, index) => ({
      pageNumber: number,
      blocks: blocksFromModel(returned[index] ?? { pageNumber: number, blocks: [] }),
    }));
  }
  return null;
}

const STRICT_PAGE_RULES = `Retry rules: Do not repeat text inside seals or stamps. One short description per seal. Keep every block concise. Return valid JSON only.`;

async function translateDocument(
  input: {
    filename: string;
    sourceLanguage: string;
    fields: ConfirmationRecord[];
    pages: Array<PageRecord & { number: number }>;
    corrections: CorrectionRecord[];
    qaIssues: QaIssue[];
  },
  signal?: AbortSignal,
) {
  const notes = input.corrections
    .map((correction) => {
      const page = input.pages.find((item) => item.number === correction.pageNumber);
      if (!page) return null;
      const highlighted = correction.passage ? ` Highlighted text: "${correction.passage}".` : "";
      return `Page ${correction.pageNumber}.${highlighted} Change: ${correction.note ?? ""}`;
    })
    .filter((note): note is string => Boolean(note));

  const pageText = input.pages
    .map((page) => `Page ${page.number}:\n${(page.ocrText ?? "").slice(0, 6000)}`)
    .join("\n\n");

  const qaNotes = input.qaIssues
    .map((item) => `Page ${item.page ?? "all"} (${item.type}): ${item.note} Original: ${item.original}`)
    .join("\n");

  const expected = input.pages.map((page) => page.number);
  const deadline = signal ?? AbortSignal.timeout(TRANSLATION_DEADLINE_MS);
  let last: ModelPage[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
    const strict = attempt === 1;
    const prompt = `Translate this document into English, one original page to one translated page.
Source language: ${input.sourceLanguage}.
File: ${input.filename}.

Use these confirmed spellings exactly whenever the person, the parents, the birthplace, or the date of birth appears. Do not invent a name that was confirmed as absent.
Write every date in the translation, including the date of birth, using this format: ${dateFormatOf(input.fields)}.

Confirmed fields:
${confirmedBlock(input.fields)}

${notes.length ? `The customer asked for these corrections:\n${notes.join("\n")}` : "There are no correction notes."}

${qaNotes ? `A previous translation failed QA. Fix every item and keep confirmed names, dates, and numbers:\n${qaNotes}` : "There are no QA notes."}

Return one object per page number.
${translationBlockRules()}
${strict ? `${STRICT_PAGE_RULES}\n` : ""}${pageText}`;
    try {
      const result = await generateObject(
        translationDocumentSchema,
        [{ role: "user", content: [{ type: "text", text: prompt }] }],
        deadline,
        translationGenerateOptions(),
      );
      last = result.pages;
      const aligned = alignPages(expected, result.pages);
      if (aligned) return aligned;
    } catch (error) {
      if (!isTemporaryTranslationError(error) || attempt === 1 || deadline.aborted) throw error;
    }
  }
  const fallback = alignPages(expected, last);
  if (fallback) return fallback;
  throw new HttpError("The translation did not return every page.", 502);
}

function pagePrompt(
  input: {
    filename: string;
    sourceLanguage: string;
    fields: ConfirmationRecord[];
    page: PageRecord & { number: number };
    corrections: CorrectionRecord[];
    qaIssues: QaIssue[];
  },
  strict: boolean,
): string {
  const notes = input.corrections
    .filter((correction) => correction.pageNumber === input.page.number)
    .map((correction) => {
      const highlighted = correction.passage ? ` Highlighted text: "${correction.passage}".` : "";
      return `Page ${correction.pageNumber}.${highlighted} Change: ${correction.note ?? ""}`;
    });
  const qaNotes = input.qaIssues
    .map((item) => `Page ${item.page ?? "all"} (${item.type}): ${item.note} Original: ${item.original}`)
    .join("\n");
  return `Translate this document into English, one original page to one translated page.
Source language: ${input.sourceLanguage}.
File: ${input.filename}.

Use these confirmed spellings exactly whenever the person, the parents, the birthplace, or the date of birth appears. Do not invent a name that was confirmed as absent.
Write every date in the translation, including the date of birth, using this format: ${dateFormatOf(input.fields)}.

Confirmed fields:
${confirmedBlock(input.fields)}

${notes.length ? `The customer asked for these corrections:\n${notes.join("\n")}` : "There are no correction notes."}

${qaNotes ? `A previous translation failed QA. Fix every item and keep confirmed names, dates, and numbers:\n${qaNotes}` : "There are no QA notes."}

Return one page object for page ${input.page.number}.
${translationBlockRules()}
${strict ? `${STRICT_PAGE_RULES}\n` : ""}Page ${input.page.number}:
${(input.page.ocrText ?? "").slice(0, 6000)}`;
}

/** One billable page. Unreadable JSON is retried once with a stricter prompt. */
async function translateOnePage(input: {
  filename: string;
  sourceLanguage: string;
  fields: ConfirmationRecord[];
  page: PageRecord & { number: number };
  corrections: CorrectionRecord[];
  qaIssues: QaIssue[];
}): Promise<RenderBlock[]> {
  const deadline = AbortSignal.timeout(TRANSLATION_PAGE_DEADLINE_MS);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
    const strict = attempt === 1;
    const fallback = strict ? translationFallbackModelId() : null;
    try {
      const result = await raceWorkAgainstDeadline(
        generateObject(
          translationPageSchema,
          [{ role: "user", content: [{ type: "text", text: pagePrompt(input, strict) }] }],
          deadline,
          translationGenerateOptions(fallback),
        ),
        deadline,
      );
      const page = result;
      if (!page) throw new HttpError("The translation did not return the page.", 502);
      const aligned = alignPages([input.page.number], [page]);
      if (!aligned?.[0]) throw new HttpError("The translation did not return the page.", 502);
      return aligned[0].blocks;
    } catch (error) {
      lastError = error;
      if (!isUnreadableModelOutput(error) || strict || deadline.aborted) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new HttpError("The translation did not return the page.", 502);
}

/** Write a terminal status when a translation is still Processing or waiting on the first preview. */
export async function recordTranslationFailure(db: Db, orderId: string, error: unknown): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order) return;
  const translating = order.progress?.step === "translating";
  const stuck =
    order.status === "processing" ||
    (translating && (order.status === "confirmed" || order.status === "correction_requested"));
  if (!stuck) return;
  const open = (await listCorrections(db, orderId)).filter((correction) => correction.status === "open");
  const decision = decideTranslationFailure({
    error,
    readyPreview: (await latestReadyPreview(db, orderId)) != null,
    openCorrections: open.length > 0,
  });
  const wrote = await updateOrder(
    db,
    orderId,
    {
      status: decision.status,
      review_reason: decision.reviewReason,
      progress: checkedProgress(order.progress, { step: "done" }),
    },
    { statuses: OPEN_TRANSLATION_STATUSES },
  );
  if (wrote === false || !decision.notifyFailed) return;
  const { notifyOrder } = await import("./webhook-delivery");
  await notifyOrder(db, orderId, "order.failed");
}

/**
 * Starts one function invocation per billable page. Skipped pages are not translated.
 * The layout and watermarked preview run in a later invocation, after every page is ready.
 * The deadline fires before maxDuration so a hung start still writes status and review_reason.
 */
export async function translateOrder(db: Db, orderId: string, token: string | null): Promise<void> {
  const deadline = AbortSignal.timeout(TRANSLATION_DEADLINE_MS);
  try {
    await raceWorkAgainstDeadline(startPageTranslation(db, orderId, token), deadline);
  } catch (error) {
    await recordTranslationFailure(db, orderId, error);
    if (!isTemporaryTranslationError(error)) throw error;
  }
}

async function startPageTranslation(db: Db, orderId: string, token: string | null): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order) return;
  const open = (await listCorrections(db, orderId)).filter((correction) => correction.status === "open");
  if (order.status === "preview_ready" && open.length === 0) return;
  if (
    order.status === "approved" ||
    order.status === "delivered" ||
    order.status === "cancelled" ||
    (order.status === "paid" && order.finalTranslationPath)
  ) {
    return;
  }
  if (!order.languageConfirmed || !order.sourceLanguage) {
    throw new HttpError("Confirm the language and the name fields before translation.", 409);
  }

  // The failed attempt leaves its run open. Resuming it finishes stale jobs and
  // never clears status. A new version makes those jobs a no-op.
  if (canRetryFailedTranslation(order)) {
    await beginTranslation(db, order, token, { round: 0, qaIssues: [], retryFailure: true });
    return;
  }

  const openRun = await findOpenRun(db, orderId);
  if (openRun) {
    await resumeTranslation(db, openRun);
    return;
  }
  await beginTranslation(db, order, token, { round: 0, qaIssues: [] });
}

export async function runTranslationPage(
  db: Db,
  input: { orderId: string; version: number; jobId: string },
): Promise<void> {
  const claimed = await claimPageJob(db, input.jobId);
  if (!claimed || claimed.orderId !== input.orderId || claimed.version !== input.version) return;
  try {
    const work = await loadPageWork(db, claimed.id);
    if (!work?.order.sourceLanguage) throw new HttpError("The page is not ready to translate.", 409);
    const blocks = await translateOnePage({
      filename: work.filename,
      sourceLanguage: work.order.sourceLanguage,
      fields: work.fields,
      page: work.page,
      corrections: work.corrections,
      qaIssues: work.qaIssues,
    });
    const output: PageJobOutput = { blocks, paragraphs: blocksToParagraphs(blocks) };
    await completePageJob(db, claimed, output);
  } catch (error) {
    await failPageJob(db, claimed, error);
    if (pageAttemptResult(claimed.attempts, false) === "fail") {
      await ensurePageFailureReviewed(db, claimed.orderId, error);
    }
  }
}

/** A finished page job must not leave the order in processing. Staff are told at once. */
async function ensurePageFailureReviewed(db: Db, orderId: string, error: unknown): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order) return;
  const open = (OPEN_TRANSLATION_STATUSES as readonly string[]).includes(order.status);
  if (!open && order.status !== "needs_review") return;
  const raw = error instanceof Error ? error.message : "Translation failed.";
  const reviewReason = isTemporaryTranslationError(error)
    ? TRANSLATION_TIMEOUT_REASON
    : (humanReviewReason(raw) ?? "Translation failed.");
  if (order.status !== "needs_review" || order.reviewReason !== reviewReason) {
    const wrote = await updateOrder(
      db,
      orderId,
      {
        status: "needs_review",
        review_reason: reviewReason,
        progress: checkedProgress(order.progress, { step: "done" }),
      },
      { statuses: OPEN_TRANSLATION_STATUSES },
    );
    if (wrote === false) return;
  }
  await alertStaffForHeldTranslation(db, orderId, reviewReason);
}

async function alertStaffForHeldTranslation(db: Db, orderId: string, reviewReason: string): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order || order.staffAlertSentAt) return;
  const at = new Date().toISOString();
  const claimed = await claimOrderColumn(db, order.id, "staff_alert_sent_at", at);
  if (!claimed) return;
  try {
    const recipients = staffAlertRecipients();
    if (recipients.length === 0) {
      await clearOrderColumn(db, order.id, "staff_alert_sent_at", at);
      return;
    }
    const result = await sendTranslationFailureAlert(recipients, {
      orderId: order.id,
      reason: humanReviewReason(reviewReason) ?? "Translation failed.",
      studioUrl: adminStudioLink(order.id),
    });
    if (!result.sent) await clearOrderColumn(db, order.id, "staff_alert_sent_at", at);
  } catch (error) {
    await clearOrderColumn(db, order.id, "staff_alert_sent_at", at);
    console.error(error instanceof Error ? error.message : "staff alert failed");
  }
}

export async function runTranslationAssemble(
  db: Db,
  input: { orderId: string; version: number },
): Promise<void> {
  const run = await getTranslationRun(db, input.orderId, input.version);
  if (!run || run.status === "ready" || run.status === "failed") return;
  if (run.status === "running") {
    const claimed = await claimAssemble(db, input.orderId, input.version);
    if (!claimed) return;
  }

  const order = await getOrderById(db, input.orderId);
  if (!order?.sourceLanguage) return;
  const sourceLanguage = order.sourceLanguage;
  const open = (await listCorrections(db, input.orderId)).filter((correction) => correction.status === "open");

  try {
    const deadline = AbortSignal.timeout(TRANSLATION_DEADLINE_MS);
    await raceWorkAgainstDeadline(
      (async () => {
        const { documents, pages } = await loadOrderPages(db, input.orderId);
        const jobs = await listPageJobs(db, input.orderId, input.version);
        const ready = new Map(jobs.filter((job) => job.status === "ready" && job.output).map((job) => [job.pageId, job]));
        if (jobs.some((job) => job.status !== "ready" || !job.output)) {
          throw new HttpError("The translation did not return every page.", 502);
        }

        const renderedPages: RenderPage[] = [];
        const translatedCounts = new Map<string, number>();
        const model = translationModelId();
        for (const document of documents) {
          const documentPages = pages.filter((page) => page.documentId === document.id);
          const stored = documentPages.map((page) => {
            if (isSkippedTranslationPage(page)) {
              const blocks = passThroughBlocks(page.ocrText);
              return {
                page,
                blocks,
                paragraphs: blocksToParagraphs(blocks),
              };
            }
            const job = ready.get(page.id);
            if (!job?.output) throw new HttpError("The translation did not return every page.", 502);
            return { page, blocks: job.output.blocks, paragraphs: job.output.paragraphs };
          });
          await insertTranslation(db, {
            documentId: document.id,
            version: input.version,
            model,
            status: "ready",
            output: {
              pages: stored.map((page) => ({
                pageNumber: page.page.pageNumber,
                combinedPageNumber: page.page.number,
                paragraphs: page.paragraphs,
                blocks: page.blocks,
              })),
            },
          });
          translatedCounts.set(document.id, documentPages.length);
          for (const page of stored) {
            renderedPages.push({
              combinedPageNumber: page.page.number,
              widthPt: page.page.widthPt ?? 612,
              heightPt: page.page.heightPt ?? 792,
              paragraphs: page.paragraphs,
              blocks: page.blocks,
            });
          }
        }

        const today = new Date().toISOString().slice(0, 10);
        const configuredSignature = loadTranslatorSignature();
        const confirmations = await listConfirmations(db, input.orderId);
        const clientEmail = await customerEmail(db, order.customerId);
        const previewPath = `${input.orderId}/preview-v${input.version}.pdf`;
        const files = await renderOrderPdfs({
          orderId: input.orderId,
          sourceLanguage,
          targetLanguage: order.targetLanguage,
          date: today,
          pages: renderedPages,
          clientName: coverClientName(confirmations, clientEmail),
          documents: coverDocuments(documents, pages, translatedCounts),
          translatorName: coverTranslatorName(null),
          signature: coverSignature(null, configuredSignature),
        });
        const translationPath = `${input.orderId}/translation-v${input.version}.pdf`;
        const certificationPath = `${input.orderId}/certification-v${input.version}.pdf`;
        await uploadObject(db, "finals", translationPath, files.cleanTranslation, "application/pdf");
        await uploadObject(db, "finals", certificationPath, files.certification, "application/pdf");
        await uploadObject(db, "previews", previewPath, files.watermarkedPreview, "application/pdf");
        if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
        const active = await getTranslationRun(db, input.orderId, input.version);
        if (!active || active.status === "failed" || active.status === "ready") return;

        const assessment = assessTranslation({
          originalPages: pages.map((page) => ({ number: page.number, text: page.ocrText ?? "" })),
          translatedPages: renderedPages.map((page) => ({
            number: page.combinedPageNumber,
            text: page.paragraphs.join("\n"),
          })),
          confirmations,
        });
        const attempt = qaAttemptForRound(run.round);
        const status = qaStatusForRun({ pass: assessment.pass, attempt });
        await insertQaRun(db, {
          orderId: input.orderId,
          attempt,
          status,
          score: assessment.score,
          issues: assessment.pass ? [] : assessment.issues,
        });
        const current = await getOrderById(db, input.orderId);
        const keepPaid = current?.status === "paid";
        if (!assessment.pass) {
          await markPreview(db, input.orderId, input.version, "failed");
          await markRunFailed(db, input.orderId, input.version);
          if (jobs.length > 0 && qaWillRetry({ pass: false, attempt })) {
            if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
            const fresh = await getOrderById(db, input.orderId);
            if (!fresh) return;
            await beginTranslation(db, fresh, run.token, { round: run.round + 1, qaIssues: assessment.issues });
            return;
          }
          if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
          const wrote = await updateOrder(
            db,
            input.orderId,
            {
              status: "needs_review",
              review_reason: QA_REVIEW_REASON,
              progress: checkedProgress(order.progress, { step: "done" }),
            },
            { statuses: OPEN_TRANSLATION_STATUSES },
          );
          if (wrote === false && !keepPaid) return;
          if (keepPaid || current?.paidAt) {
            const { settlePaidOrder } = await import("./paid-release");
            await settlePaidOrder(db, input.orderId);
          }
          return;
        }

        await markPreview(db, input.orderId, input.version, "ready");
        await updateOrder(db, input.orderId, {
          final_translation_path: translationPath,
          certification_path: certificationPath,
        });
        await resolveCorrections(db, open.map((correction) => correction.id), input.version);

        if (clientEmail) {
          await sendPreviewReady(clientEmail, {
            token: run.token,
            orderId: order.id,
            sourceLanguage,
            targetLanguage: order.targetLanguage,
            documentCount: documents.length,
            pageCount: order.billablePages,
            totalCents: order.totalCents,
            includesTranslation: true,
          });
        }
        if (!(await latestReadyPreview(db, input.orderId))) {
          throw new HttpError("Preview did not save.", 500);
        }
        await insertEvent(db, input.orderId, "preview_ready", { version: input.version });

        const stillOpen = (await listCorrections(db, input.orderId)).filter((correction) => correction.status === "open");
        const settled = checkedProgress(order.progress, {
          step: "done",
          pagesDone: jobs.length,
          pagesTranslateTotal: jobs.length,
        });
        if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
        if (stillOpen.length === 0) {
          await updateOrder(db, input.orderId, {
            ...(keepPaid ? {} : { status: "preview_ready" }),
            review_reason: null,
            progress: settled,
          });
        } else if (keepPaid) {
          await updateOrder(db, input.orderId, { progress: settled });
        } else {
          await updateOrder(db, input.orderId, { status: "correction_requested", progress: settled });
        }
        await markRunReady(db, input.orderId, input.version);
        const { notifyLifecycle } = await import("./webhook-delivery");
        await notifyLifecycle(db, input.orderId, "order.preview_ready");
        if (keepPaid || current?.paidAt) {
          const { settlePaidOrder } = await import("./paid-release");
          await settlePaidOrder(db, input.orderId);
        }
      })(),
      deadline,
    );
  } catch (error) {
    await failTranslationOrder(db, { orderId: input.orderId, version: input.version, error });
  }
}


/**
 * Watermarked certified-translation preview for an evaluation.
 * Same preview pass as a translation order: watermark on, certification cover off.
 * The clean translation and the certification page are not stored.
 */
export async function watermarkedTranslationPreview(
  db: Db,
  input: {
    orderId: string;
    sourceLanguage: string;
    targetLanguage: string;
    customerId: string;
  },
): Promise<Uint8Array> {
  const documents = inReadingOrder(await listDocuments(db, input.orderId));
  const pages = withCombinedNumbers(
    documents,
    await listPages(
      db,
      documents.map((document) => document.id),
    ),
  );
  if (pages.length === 0) throw new Error("The original pages are not ready to translate.");

  const confirmations = await listConfirmations(db, input.orderId);
  const clientEmail = await customerEmail(db, input.customerId);
  const renderedPages: RenderPage[] = [];
  const translatedCounts = new Map<string, number>();
  for (const document of documents) {
    const documentPages = pages.filter((page) => page.documentId === document.id);
    if (documentPages.length === 0) continue;
    const billable = documentPages.filter((page) => !isSkippedTranslationPage(page));
    const translated = billable.length
      ? await translateDocument({
          filename: document.filename,
          sourceLanguage: input.sourceLanguage,
          fields: confirmations.filter((field) => field.documentId === document.id),
          pages: billable,
          corrections: [],
          qaIssues: [],
        })
      : [];
    const byNumber = new Map(translated.map((page) => [page.pageNumber, page.blocks]));
    translatedCounts.set(document.id, documentPages.length);
    for (const page of documentPages) {
      const blocks = byNumber.get(page.number) ?? passThroughBlocks(page.ocrText);
      renderedPages.push({
        combinedPageNumber: page.number,
        widthPt: page.widthPt ?? 612,
        heightPt: page.heightPt ?? 792,
        paragraphs: blocksToParagraphs(blocks),
        blocks,
      });
    }
  }
  if (renderedPages.length === 0) throw new Error("The original pages are not ready to translate.");

  const configuredSignature = loadTranslatorSignature();
  const files = await renderOrderPdfs({
    orderId: input.orderId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    date: new Date().toISOString().slice(0, 10),
    pages: renderedPages,
    clientName: coverClientName(confirmations, clientEmail),
    documents: coverDocuments(documents, pages, translatedCounts),
    translatorName: coverTranslatorName(null),
    signature: coverSignature(null, configuredSignature),
  });
  return files.watermarkedPreview;
}
