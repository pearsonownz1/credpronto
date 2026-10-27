import { z } from "zod";
import { generateObject } from "./ai";
import { SPARSE_PAGE_WORDS } from "./constants";
import {
  claimDocuments,
  getOrderById,
  hasEvent,
  insertEvent,
  listDocuments,
  markDocuments,
  replaceExtractedConfirmations,
  replacePages,
  setOrderProgress,
  updateDocument,
  updateOrder,
  type Db,
} from "./db";
import { AiUnavailableError } from "./errors";
import { CONFIRMATION_FIELD_KEYS, blankToNull, type DateFormat } from "./fields";
import { isQualityFlag, pageQuality, type QualityFlag } from "./image-quality";
import { normalizeLanguage } from "./languages";
import {
  applyPageOrder,
  filesInAppliedOrder,
  isIdentityOrder,
  pdfPagePermutation,
  permutePdfPages,
  positivePage,
  type PageCue,
} from "./page-order";
import { buildCombinedOriginal, type SourceFile } from "./pdf/combine";
import { pdfPageTexts } from "./pdf-text";
import { completeEvaluation, shouldPrepareEvaluationReport, startEvaluationQuote } from "./evaluation";
import { orderHasEvaluation } from "./service-selection";
import { decideQuote, etaFromNow } from "./quote";
import { humanReviewReason } from "./review-reason";
import { notifyOrder } from "./webhook-delivery";
import { downloadObject, uploadObject } from "./storage";
import { quotePage, storedDensity } from "./billing";
import { queueEarlyTranslation } from "./translation-jobs";
import { isGcsOrder } from "./gcs";
import type { ReadingStep } from "./reading-progress";
import { countWords } from "./words";
import type { DocumentRecord } from "./types";

const cueShape = {
  logicalPage: z.number(),
  orderHint: z.string(),
  orderConfidence: z.number(),
  legibility: z.number(),
  flags: z.array(z.enum(["blurry", "cropped", "glare", "too_dark", "unreadable_fields"])),
};

const ocrSchema = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number(),
      text: z.string(),
      unreadable: z.boolean(),
      confidence: z.number(),
      ...cueShape,
    }),
  ),
});

const textOrderSchema = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number(),
      ...cueShape,
    }),
  ),
});

const readingSchema = z.object({
  language: z.string(),
  confidence: z.number(),
  full_name: z.string(),
  date_of_birth: z.string(),
  parent_names: z.string(),
  place_of_birth: z.string(),
  date_format: z.string(),
});

type FieldReading = z.infer<typeof readingSchema>;

const FIELD_INSTRUCTIONS = `Read this document for a certified translation into English.
Return ISO 639-1 language and a confidence from 0 to 1.
Extract only what is printed. Use an empty string when a field is absent. Do not invent names.
full_name: the person's full name as spelled. If several people are named, join them with "; ".
date_of_birth: the date of birth as written.
parent_names: the parents' names as spelled, joined with "; ".
place_of_birth: the place of birth as spelled.
date_format: MM/DD/YYYY or DD/MM/YYYY if the dates on the page show which order is used, otherwise empty.`;

/**
 * Language and name detection can overlap the text-layer read when the layer is dense.
 * A thin layer returns null so detection waits for OCR text instead of a second vision call.
 */
export function fieldDetectionText(texts: readonly string[]): string | null {
  const joined = texts
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
  if (countWords(joined) < SPARSE_PAGE_WORDS) return null;
  return joined;
}

type PageRead = {
  text: string;
  needsReview: boolean;
  logicalPage: number | null;
  orderHint: string | null;
  orderConfidence: number | null;
  legibility: number | null;
  flags: QualityFlag[];
  visual: boolean;
};

type ModelCue = {
  pageNumber: number;
  logicalPage: number;
  orderHint: string;
  orderConfidence: number;
  legibility: number;
  flags: readonly string[];
};

const CUE_INSTRUCTIONS = `logicalPage: the printed page number when one is visible, including the N in "page N/M", "1/2", or "2 sur 2". Use 0 when there is no printed number and no sequence cue. Do not invent a number from the order the files were uploaded.
orderHint: the cue itself, such as "page 1/2", "2/2", or "suite". Use an empty string when there is none.
orderConfidence: a number from 0 to 1. Use 0.8 or higher only when the printed number or a continuation cue (suite, continued, siguiente) is clear. Use a lower score when you are guessing.
legibility: a number from 0 to 1. 1 is sharp and complete. Score a photo or scan down only when the core printed or handwritten document text cannot be read. Handwritten fill-in-the-blank entries, stamps, creases, or normal indoor shadows on an otherwise readable certificate photo are still high-legibility (0.7+) when the wording can be read. If you set blurry, too_dark, unreadable_fields, or cropped, the score must be below 0.6. A high score does not cancel those flags.
flags: any of blurry, cropped, glare, too_dark, unreadable_fields that apply. Set blurry, too_dark, or unreadable_fields only when the core document text cannot be read at all — not for handwritten blanks, stamps, creases, or normal indoor lighting on a readable phone photo. Set cropped only when the crop cuts off text, not when a margin is missing and every line is still readable. Use an empty array when the page is readable. A blank page is unreadable for transcription but is not an image-quality failure: set legibility to 1, flags to [], and unreadable to true.`;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function guessedDateFormat(value: string): DateFormat | null {
  const normalized = value.trim().toUpperCase().replace(/-/g, "/");
  if (normalized === "MM/DD/YYYY" || normalized === "DD/MM/YYYY") return normalized;
  return null;
}

function blankRead(text: string): PageRead {
  return {
    text,
    needsReview: false,
    logicalPage: null,
    orderHint: null,
    orderConfidence: null,
    legibility: null,
    flags: [],
    visual: false,
  };
}

function applyCue(read: PageRead, cue: ModelCue, visual: boolean): PageRead {
  return {
    ...read,
    logicalPage: positivePage(cue.logicalPage),
    orderHint: cue.orderHint.trim().slice(0, 200) || null,
    orderConfidence: clamp01(cue.orderConfidence),
    legibility: clamp01(cue.legibility),
    flags: cue.flags.filter(isQualityFlag),
    visual: visual || read.visual,
  };
}

export async function imageBytesForModel(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (mime === "image/jpeg" || mime === "image/png") return { bytes, mime };
  if (mime === "image/heic" || mime === "image/heif") {
    const convert = (await import("heic-convert")).default;
    const png = await convert({ buffer: Buffer.from(bytes), format: "PNG" });
    return { bytes: new Uint8Array(png), mime: "image/png" };
  }
  const sharp = (await import("sharp")).default;
  const png = await sharp(Buffer.from(bytes)).png().toBuffer();
  return { bytes: new Uint8Array(png), mime: "image/png" };
}

async function assessFile(
  bytes: Uint8Array,
  mime: string,
  pageCount: number,
  texts: string[],
): Promise<PageRead[]> {
  const reads: PageRead[] = Array.from({ length: pageCount }, (_, index) => blankRead((texts[index] ?? "").trim()));
  if (pageCount === 0) return reads;

  const sparse = reads
    .map((page, index) => ({ index, words: countWords(page.text) }))
    .filter((page) => page.words < SPARSE_PAGE_WORDS)
    .map((page) => page.index + 1);
  const image = mime !== "application/pdf";
  const visualPages = new Set(image ? reads.map((_, index) => index + 1) : sparse);

  if (!image && sparse.length === 0) {
    try {
      const excerpt = reads
        .map((page, index) => `Page ${index + 1}:\n${page.text.slice(0, 3000)}`)
        .join("\n\n");
      const result = await generateObject(textOrderSchema, [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `These are text layers from one uploaded file, in upload order. Return one object per page for page numbers ${reads.map((_, index) => index + 1).join(", ")}.
For a clean digital text page, set legibility to 1 and flags to an empty array unless the text is empty or garbled.
${CUE_INSTRUCTIONS}

${excerpt}`,
            },
          ],
        },
      ]);
      for (const page of result.pages) {
        const index = Math.round(page.pageNumber) - 1;
        const current = reads[index];
        if (!current) continue;
        reads[index] = applyCue(current, page, false);
      }
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) throw error;
    }
    return reads;
  }

  try {
    const file = mime === "application/pdf" ? { bytes, mime } : await imageBytesForModel(bytes, mime);
    const requested = reads.map((_, index) => index + 1);
    const result = await generateObject(ocrSchema, [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Read this uploaded file for a certified translation. Return one object for every page. pageNumber is the page in this file, starting at 1, in the file's current order. Requested page numbers: ${requested.join(", ")}.
text: plain transcription. Preserve names, dates, and place names exactly as spelled. Empty string if the page is blank or unreadable.
unreadable: true if the page is blank or unreadable.
confidence: 0 to 1 for the transcription.
${CUE_INSTRUCTIONS}`,
          },
          { type: "file", mediaType: file.mime, data: file.bytes },
        ],
      },
    ]);
    for (const page of result.pages) {
      const pageNumber = Math.round(page.pageNumber);
      const index = pageNumber - 1;
      const current = reads[index];
      if (!current) continue;
      const visual = visualPages.has(pageNumber);
      let next = current;
      if (visual) {
        const text = page.text.trim();
        const unreadable = page.unreadable || countWords(text) === 0;
        next = { ...current, text, needsReview: unreadable || clamp01(page.confidence) < 0.5 };
      }
      reads[index] = applyCue(next, page, visual);
    }
    for (const pageNumber of sparse) {
      if (!result.pages.some((page) => Math.round(page.pageNumber) === pageNumber)) {
        const current = reads[pageNumber - 1] ?? blankRead("");
        reads[pageNumber - 1] = { ...current, needsReview: true, visual: true };
      }
    }
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    for (const pageNumber of sparse) {
      const current = reads[pageNumber - 1] ?? blankRead("");
      reads[pageNumber - 1] = { ...current, needsReview: true, visual: true };
    }
  }

  return reads;
}

async function readFields(text: string): Promise<FieldReading | null> {
  const sample = text.slice(0, 8000);
  if (!sample.trim()) return null;
  try {
    return await generateObject(readingSchema, [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${FIELD_INSTRUCTIONS}

Document text:
${sample}`,
          },
        ],
      },
    ]);
  } catch (error) {
    if (error instanceof AiUnavailableError) return null;
    throw error;
  }
}

type ExtractedFile = {
  bytes: Uint8Array;
  mime: string;
  texts: string[];
  pageCount: number;
};

/**
 * Dense text overlaps language detection with the text-layer read.
 * A scan or photo finishes OCR first, then detects from that text.
 * A second vision call on the raw file stalls behind the model abort.
 */
async function readDocument(file: ExtractedFile): Promise<{ reads: PageRead[]; reading: FieldReading | null }> {
  const detectionText = fieldDetectionText(file.texts);
  if (detectionText) {
    const [reads, reading] = await Promise.all([
      assessFile(file.bytes, file.mime, file.pageCount, file.texts),
      readFields(detectionText),
    ]);
    return { reads, reading };
  }
  const reads = await assessFile(file.bytes, file.mime, file.pageCount, file.texts);
  const joined = reads
    .map((page) => page.text.trim())
    .filter(Boolean)
    .join("\n");
  return { reads, reading: await readFields(joined) };
}

type Slot = {
  document: DocumentRecord;
  documentId: string;
  bytes: Uint8Array;
  mime: string;
  reads: PageRead[];
  reading: FieldReading | null;
  uploadPosition: number;
};

/** Website quotes run on an unconfirmed draft. A confirmed language means that pass already finished. */
export function orderAwaitingAnalysis(order: { languageConfirmed: boolean; status: string } | null): boolean {
  if (!order || order.languageConfirmed) return false;
  return order.status === "draft" || order.status === "failed";
}

/**
 * GCS staff edit uncertain handwritten fields in the translation drawer, so
 * image-quality and language-confidence holds must not block translation when
 * a source language is already known or detected.
 */
export function releaseGcsAnalysisHold<T extends { status: "quoted" | "needs_review"; reviewReason: string | null; etaHours: number }>(
  decision: T,
  sourceLanguage: string | null | undefined,
): T {
  if (!sourceLanguage?.trim()) return decision;
  if (decision.status === "quoted") return decision;
  return { ...decision, status: "quoted", reviewReason: null, etaHours: 1 };
}

export async function analyzeOrder(db: Db, orderId: string, token: string | null = null): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order || !orderAwaitingAnalysis(order)) return;

  const documents = await claimDocuments(db, orderId);
  if (documents.length === 0) return;

  let pagesRead = 0;
  let pagesTotal = 0;
  const writeProgress = (step: ReadingStep) =>
    setOrderProgress(db, orderId, { step, pagesRead, pagesTotal });

  try {
    await writeProgress("reading");
    const extracted: Array<{
      document: DocumentRecord;
      bytes: Uint8Array;
      mime: string;
      texts: string[];
      pageCount: number;
      uploadPosition: number;
    }> = [];
    for (const document of documents) {
      const bytes = await downloadObject(db, "originals", document.originalPath);
      const mime = document.mime ?? "application/pdf";
      const texts =
        mime === "application/pdf"
          ? await pdfPageTexts(bytes, async ({ pageNumber, pageCount }) => {
              if (pageNumber === 1) pagesTotal += pageCount;
              pagesRead += 1;
              await writeProgress("reading");
            })
          : [];
      const pageCount = mime === "application/pdf" ? texts.length : 1;
      if (mime !== "application/pdf") {
        pagesTotal += 1;
        pagesRead += 1;
        await writeProgress("reading");
      }
      extracted.push({
        document,
        bytes,
        mime,
        texts,
        pageCount,
        uploadPosition: document.position > 0 ? document.position : extracted.length + 1,
      });
    }

    const slots: Slot[] = [];
    for (const file of extracted) {
      const { reads, reading } = await readDocument(file);
      slots.push({
        document: file.document,
        documentId: file.document.id,
        bytes: file.bytes,
        mime: file.mime,
        reads,
        reading,
        uploadPosition: file.uploadPosition,
      });
    }

    const cues: PageCue[] = [];
    for (const slot of slots) {
      slot.reads.forEach((read, index) => {
        cues.push({
          documentId: slot.documentId,
          uploadPosition: slot.uploadPosition,
          uploadPage: index + 1,
          logicalPage: read.logicalPage,
          hint: read.orderHint,
          confidence: read.orderConfidence,
        });
      });
    }
    const applied = applyPageOrder(cues);
    const ordered = filesInAppliedOrder(slots, applied);
    const files: SourceFile[] = ordered.map((slot) => ({ bytes: slot.bytes, mime: slot.mime }));
    const combined = await buildCombinedOriginal(files);
    const metas = combined.pages.map((page) => {
      const slot = ordered[page.sourceIndex];
      if (!slot) throw new Error("Combined page is missing its source file");
      return {
        documentId: slot.documentId,
        uploadPage: page.sourcePage,
        widthPt: page.widthPt,
        heightPt: page.heightPt,
      };
    });
    const permutation = pdfPagePermutation(
      ordered.map((slot) => ({ documentId: slot.documentId, pageCount: slot.reads.length })),
      applied,
    );
    const pdf = isIdentityOrder(permutation) ? combined.pdf : await permutePdfPages(combined.pdf, permutation);
    const combinedPath = `${orderId}/original-combined.pdf`;
    await uploadObject(db, "originals", combinedPath, pdf, "application/pdf");
    const metaByKey = new Map(metas.map((meta) => [`${meta.documentId}:${meta.uploadPage}`, meta]));

    await writeProgress("language");

    const extractedFields: Array<{ documentId: string; fieldKey: string; originalValue: string | null }> = [];
    const languages: string[] = [];
    const confidences: number[] = [];
    let missedDetection = false;
    const pageBillable: number[] = [];
    const pageNeedsReview: boolean[] = [];
    let pageIndex = 0;
    const transcripts: string[] = [];
    let imageQuality = false;
    const prepared: Array<{
      slot: Slot;
      docPages: typeof applied.pages;
      language: string | null;
      confidence: number | null;
    }> = [];

    for (const slot of ordered) {
      const docPages = applied.pages
        .filter((page) => page.documentId === slot.documentId)
        .sort((a, b) => a.appliedPage - b.appliedPage);
      const joined = docPages
        .map((page) => slot.reads[page.uploadPage - 1]?.text ?? "")
        .filter(Boolean)
        .join("\n");
      transcripts.push(joined);
      const reading = slot.reading;
      if (!reading) missedDetection = true;

      const language = normalizeLanguage(reading?.language);
      const confidence = reading ? clamp01(reading.confidence) : null;
      if (language) languages.push(language);
      if (confidence != null) confidences.push(confidence);

      const values: Record<(typeof CONFIRMATION_FIELD_KEYS)[number], string | null> = {
        full_name: blankToNull(reading?.full_name),
        date_of_birth: blankToNull(reading?.date_of_birth),
        parent_names: blankToNull(reading?.parent_names),
        place_of_birth: blankToNull(reading?.place_of_birth),
        date_format: reading ? guessedDateFormat(reading.date_format) : null,
      };
      for (const fieldKey of CONFIRMATION_FIELD_KEYS) {
        extractedFields.push({
          documentId: slot.documentId,
          fieldKey,
          originalValue: values[fieldKey],
        });
      }
      prepared.push({ slot, docPages, language, confidence });
    }

    await writeProgress("counting");

    for (const item of prepared) {
      const { slot, docPages, language, confidence } = item;
      await replacePages(
        db,
        slot.documentId,
        docPages.map((page) => {
          const read = slot.reads[page.uploadPage - 1] ?? blankRead("");
          const meta = metaByKey.get(`${slot.documentId}:${page.uploadPage}`);
          if (!meta) throw new Error("A page is missing its size");
          const quality = pageQuality({
            score: read.legibility,
            visual: read.visual,
            flags: read.flags,
            text: read.text,
            words: countWords(read.text),
          });
          if (quality.failed) imageQuality = true;
          const quoted = quotePage({
            text: read.text,
            targetLanguage: order.targetLanguage,
            pageIndex,
          });
          pageIndex += 1;
          pageBillable.push(quoted.billableUnits);
          // A blank verso, an English page, or a shipping label is free. The reader
          // marks a blank page unreadable, and that must not turn a priced quote into
          // needs_review. A page we are actually billing still holds the quote.
          const needsReview = quality.failed || (read.needsReview && !quoted.skip);
          pageNeedsReview.push(needsReview);
          return {
            pageNumber: page.appliedPage,
            wordCount: quoted.counted,
            billableUnits: storedDensity(quoted),
            billingBasis: quoted.billingBasis,
            skipped: quoted.skip,
            skipReason: quoted.skipReason,
            ocrText: read.text,
            needsReview,
            widthPt: meta.widthPt,
            heightPt: meta.heightPt,
            uploadPage: page.uploadPage,
            logicalPage: page.logicalPage,
            orderHint: page.hint,
            qualityScore: quality.score,
            qualityFlags: read.flags,
            qualityMessage: quality.message,
          };
        }),
      );

      await updateDocument(db, slot.documentId, {
        status: "ready",
        page_count: docPages.length,
        detected_language: language,
        confidence,
        applied_position: docPages[0]?.appliedPosition ?? slot.uploadPosition,
      });
    }

    await writeProgress("quoting");

    const distinct = [...new Set(languages)];
    const decision = decideQuote({
      billableUnits: pageBillable,
      pageNeedsReview,
      language: distinct[0] ?? null,
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      detectionAvailable: !missedDetection && distinct.length > 0,
      languagesDisagree: distinct.length > 1,
      imageQuality,
    });

    await replaceExtractedConfirmations(db, orderId, extractedFields);
    if (orderHasEvaluation(order) && order.degreeCount != null) {
      const context = {
        sourceLanguage: distinct.length === 1 ? distinct[0] : null,
        confidence: confidences.length > 0 ? Math.min(...confidences) : null,
        billablePages: pageBillable.reduce((sum, pages) => sum + pages, 0),
        imageQuality,
        detectionAvailable: !missedDetection && distinct.length > 0,
        languagesDisagree: distinct.length > 1,
        pageText: transcripts.join("\n"),
        filenames: ordered.map((slot) => slot.document.filename),
        combinedPath,
        pageOrderBasis: applied.basis,
        pageOrder: applied,
        token,
      };
      const prepared = shouldPrepareEvaluationReport(order)
        ? await completeEvaluation(db, order, context)
        : await startEvaluationQuote(db, order, context);
      const ready = prepared.status === "preview_ready" || prepared.status === "quoted";
      if (ready && !(await hasEvent(db, orderId, "quote_shown"))) {
        await insertEvent(db, orderId, "quote_shown", {
          billablePages: prepared.billablePages,
          totalCents: prepared.totalCents,
        });
      }
      if (ready) await notifyOrder(db, orderId, "order.quoted");
      if (ready && (order.includeTranslation || order.services?.includes("translation"))) {
        try {
          await queueEarlyTranslation(db, orderId, token);
        } catch (error) {
          console.error(error instanceof Error ? error.message : "early translation failed");
        }
      }
      await writeProgress("done");
      return;
    }

    const detectedSource = distinct.length === 1 ? distinct[0] : null;
    const sourceLanguage = isGcsOrder(order) && order.sourceLanguage ? order.sourceLanguage : detectedSource;
    const free = isGcsOrder(order);
    const settled = free ? releaseGcsAnalysisHold(decision, sourceLanguage) : decision;
    await updateOrder(db, orderId, {
      status: settled.status,
      source_language: sourceLanguage,
      billable_pages: settled.billablePages,
      total_cents: free ? 0 : settled.totalCents,
      ...(free ? { translation_cents: 0, unit_price_cents: 0 } : {}),
      review_reason: settled.reviewReason,
      eta_at: etaFromNow(settled.etaHours),
      combined_original_path: combinedPath,
      page_order_basis: applied.basis,
      page_order: applied,
      progress: { step: "done", pagesRead, pagesTotal },
    });

    if (settled.status === "quoted" && !(await hasEvent(db, orderId, "quote_shown"))) {
      await insertEvent(db, orderId, "quote_shown", {
        billablePages: settled.billablePages,
        totalCents: free ? 0 : settled.totalCents,
      });
    }
    if (settled.status === "quoted") await notifyOrder(db, orderId, "order.quoted");
    if (settled.status === "quoted") {
      try {
        await queueEarlyTranslation(db, orderId, token);
      } catch (error) {
        console.error(error instanceof Error ? error.message : "early translation failed");
      }
    }
  } catch (error) {
    await markDocuments(db, orderId, "failed");
    const message = error instanceof Error ? error.message : "We could not read the upload.";
    console.error(`analysis failed for ${orderId}: ${message}`, error);
    await updateOrder(db, orderId, {
      status: "needs_review",
      review_reason: humanReviewReason(message) ?? "We could not read the upload.",
      eta_at: etaFromNow(24),
      page_order_basis: null,
      page_order: null,
      progress: { step: "done", pagesRead, pagesTotal },
    });
  }
}

export async function documentsForOrder(db: Db, orderId: string) {
  return listDocuments(db, orderId);
}
