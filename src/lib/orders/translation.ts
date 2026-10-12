import { z } from "zod";
import { generateObject, translationModelId } from "./ai";
import { inReadingOrder } from "./page-order";
import { CONFIRMATION_FIELD_KEYS } from "./fields";
import type { RenderBlock, RenderPage } from "./pdf/layout";
import { renderOrderPdfs } from "./pdf/render";
import { blocksFromModel, blocksToParagraphs, type ModelBlock } from "./pdf/structure";
import {
  customerEmail,
  getOrderById,
  insertEvent,
  insertPreview,
  insertQaRun,
  insertTranslation,
  latestReadyPreview,
  listConfirmations,
  listCorrections,
  listDocuments,
  listPages,
  markPreview,
  nextPreviewVersion,
  resolveCorrections,
  updateOrder,
  withCombinedNumbers,
  type Db,
} from "./db";
import { sendPreviewReady } from "./email";
import { AiUnavailableError, HttpError } from "./errors";
import { QA_REVIEW_REASON, assessTranslation, qaAttemptForRound, qaStatusForRun, qaWillRetry, type QaIssue } from "./qa";
import {
  TRANSLATION_DEADLINE_MS,
  decideTranslationFailure,
  isTemporaryTranslationError,
} from "./translation-failure";
import { uploadObject } from "./storage";
import type { ConfirmationRecord, CorrectionRecord, PageRecord } from "./types";

const translationSchema = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number(),
      blocks: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            level: z.number().optional(),
            electronic: z.boolean().optional(),
            rows: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
            lines: z.array(z.string()).optional(),
          }),
        )
        .optional(),
      lines: z.array(z.string()).optional(),
      paragraphs: z.array(z.string()).optional(),
    }),
  ),
});

type ModelPage = {
  pageNumber: number;
  blocks?: ModelBlock[];
  lines?: string[];
  paragraphs?: string[];
};

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
      blocks: blocksFromModel(returned[index] ?? {}),
    }));
  }
  return null;
}

async function translateDocument(input: {
  filename: string;
  sourceLanguage: string;
  fields: ConfirmationRecord[];
  pages: Array<PageRecord & { number: number }>;
  corrections: CorrectionRecord[];
  qaIssues: QaIssue[];
}) {
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

  const prompt = `Translate this document into English, one original page to one translated page.
Source language: ${input.sourceLanguage}.
File: ${input.filename}.

Use these confirmed spellings exactly whenever the person, the parents, the birthplace, or the date of birth appears. Do not invent a name that was confirmed as absent.
Write every date in the translation, including the date of birth, using this format: ${dateFormatOf(input.fields)}.

Confirmed fields:
${confirmedBlock(input.fields)}

${notes.length ? `The customer asked for these corrections:\n${notes.join("\n")}` : "There are no correction notes."}

${qaNotes ? `A previous translation failed QA. Fix every item and keep confirmed names, dates, and numbers:\n${qaNotes}` : "There are no QA notes."}

Return one object per page number, with blocks in the original top-to-bottom order.
Keep names, CURPs, and place spellings exactly as printed or confirmed. Do not join a label and its value into a paragraph.

For a form, use type "fields" and rows of {label, value}. Translate labels into English. One row per field, in the original order. A line-broken reading (type "lines", one label or value per line) is acceptable when you cannot split a row.

For prose, use type "paragraph" and preserve paragraph breaks.

For a seal, stamp, coat of arms, or letter-spaced ring such as "C I V I L  R E G I S T R Y", use type "seal" and set text to a short place description such as "Civil Registry of Jalisco". Do not copy ring text, and do not letter-space it.

For a handwritten signature, use type "signature" with electronic false.
For an electronic signature, firma electrónica, or a long unbroken signature token, use type "signature" with electronic true. Do not copy the signature string.

For a section title, use type "heading".
${pageText}`;

  const expected = input.pages.map((page) => page.number);
  const deadline = AbortSignal.timeout(TRANSLATION_DEADLINE_MS);
  let last: ModelPage[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
    try {
      const result = await generateObject(
        translationSchema,
        [{ role: "user", content: [{ type: "text", text: prompt }] }],
        deadline,
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

export async function translateOrder(db: Db, orderId: string, token: string | null): Promise<void> {
  let pendingQa: QaIssue[] = [];
  for (let round = 0; round < 3; round += 1) {
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

    const claim = await db
      .from("orders")
      .update({ status: "processing" })
      .eq("id", orderId)
      .in("status", ["confirmed", "correction_requested", "failed", "preview_ready", "processing", "paid"])
      .select("id");
    if (claim.error) throw new Error(claim.error.message);
    if ((claim.data ?? []).length === 0) return;

    const documents = inReadingOrder(await listDocuments(db, orderId));
    const pages = withCombinedNumbers(
      documents,
      await listPages(
        db,
        documents.map((document) => document.id),
      ),
    );
    if (pages.length === 0 || !order.combinedOriginalPath) {
      throw new HttpError("The original pages are not ready to translate.", 409);
    }

    const confirmations = await listConfirmations(db, orderId);
    const version = await nextPreviewVersion(db, orderId);
    const previewPath = `${orderId}/preview-v${version}.pdf`;
    const inserted = await insertPreview(db, { orderId, version, previewPath });
    if (inserted === "exists") return;

    try {
      const renderedPages: RenderPage[] = [];
      const model = translationModelId();
      for (const document of documents) {
        const documentPages = pages.filter((page) => page.documentId === document.id);
        const fields = confirmations.filter((field) => field.documentId === document.id);
        const translated = await translateDocument({
          filename: document.filename,
          sourceLanguage: order.sourceLanguage,
          fields,
          pages: documentPages,
          corrections: open,
          qaIssues: pendingQa,
        });
        await insertTranslation(db, {
          documentId: document.id,
          version,
          model,
          status: "ready",
          output: {
            pages: translated.map((page) => ({
              pageNumber: documentPages.find((item) => item.number === page.pageNumber)?.pageNumber ?? page.pageNumber,
              combinedPageNumber: page.pageNumber,
              paragraphs: blocksToParagraphs(page.blocks),
              blocks: page.blocks,
            })),
          },
        });
        for (const page of translated) {
          const source = documentPages.find((item) => item.number === page.pageNumber);
          renderedPages.push({
            combinedPageNumber: page.pageNumber,
            widthPt: source?.widthPt ?? 612,
            heightPt: source?.heightPt ?? 792,
            paragraphs: blocksToParagraphs(page.blocks),
            blocks: page.blocks,
          });
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const files = await renderOrderPdfs({
        orderId,
        sourceLanguage: order.sourceLanguage,
        date: today,
        pages: renderedPages,
      });
      const translationPath = `${orderId}/translation-v${version}.pdf`;
      const certificationPath = `${orderId}/certification-v${version}.pdf`;
      await uploadObject(db, "finals", translationPath, files.cleanTranslation, "application/pdf");
      await uploadObject(db, "finals", certificationPath, files.certification, "application/pdf");
      await uploadObject(db, "previews", previewPath, files.watermarkedPreview, "application/pdf");

      const assessment = assessTranslation({
        originalPages: pages.map((page) => ({ number: page.number, text: page.ocrText ?? "" })),
        translatedPages: renderedPages.map((page) => ({
          number: page.combinedPageNumber,
          text: page.paragraphs.join("\n"),
        })),
        confirmations,
      });
      const attempt = qaAttemptForRound(round);
      const status = qaStatusForRun({ pass: assessment.pass, attempt });
      await insertQaRun(db, {
        orderId,
        attempt,
        status,
        score: assessment.score,
        issues: assessment.pass ? [] : assessment.issues,
      });
      if (!assessment.pass) {
        await markPreview(db, orderId, version, "failed");
        if (qaWillRetry({ pass: false, attempt })) {
          pendingQa = assessment.issues;
          continue;
        }
        await updateOrder(db, orderId, { status: "needs_review", review_reason: QA_REVIEW_REASON });
        return;
      }

      await markPreview(db, orderId, version, "ready");
      await updateOrder(db, orderId, {
        final_translation_path: translationPath,
        certification_path: certificationPath,
      });
      await resolveCorrections(db, open.map((correction) => correction.id), version);

      const email = await customerEmail(db, order.customerId);
      if (email) await sendPreviewReady(email, token);
      if (!(await latestReadyPreview(db, orderId))) {
        throw new HttpError("Preview did not save.", 500);
      }
      await insertEvent(db, orderId, "preview_ready", { version });

      const stillOpen = (await listCorrections(db, orderId)).filter((correction) => correction.status === "open");
      if (stillOpen.length === 0) {
        await updateOrder(db, orderId, { status: "preview_ready", review_reason: null });
        return;
      }
      await updateOrder(db, orderId, { status: "correction_requested" });
    } catch (error) {
      await markPreview(db, orderId, version, "failed");
      const decision = decideTranslationFailure({
        error,
        readyPreview: (await latestReadyPreview(db, orderId)) != null,
        openCorrections: open.length > 0,
      });
      await updateOrder(db, orderId, {
        status: decision.status,
        review_reason: decision.reviewReason,
      });
      if (!decision.notifyFailed) return;
      const { notifyOrder } = await import("./webhook-delivery");
      await notifyOrder(db, orderId, "order.failed");
      throw error;
    }
  }
}
