import { extractText, getDocumentProxy } from "unpdf";
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
  updateDocument,
  updateOrder,
  type Db,
} from "./db";
import { AiUnavailableError } from "./errors";
import { CONFIRMATION_FIELD_KEYS, blankToNull, type DateFormat } from "./fields";
import { normalizeLanguage } from "./languages";
import { buildCombinedOriginal, type SourceFile } from "./pdf/combine";
import { decideQuote, etaFromNow } from "./quote";
import { downloadObject, uploadObject } from "./storage";
import { billableCjkUnits, billableUnits, isCjkBillingLanguage, countCjkUnits } from "./billing";
import { countWords } from "./words";
import type { DocumentRecord } from "./types";

const readingSchema = z.object({
  language: z.string(),
  confidence: z.number(),
  full_name: z.string(),
  date_of_birth: z.string(),
  parent_names: z.string(),
  place_of_birth: z.string(),
  date_format: z.string(),
});

const ocrSchema = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number(),
      text: z.string(),
      unreadable: z.boolean(),
      confidence: z.number(),
    }),
  ),
});

type PageRead = {
  text: string;
  needsReview: boolean;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function guessedDateFormat(value: string): DateFormat | null {
  const normalized = value.trim().toUpperCase().replace(/-/g, "/");
  if (normalized === "MM/DD/YYYY" || normalized === "DD/MM/YYYY") return normalized;
  return null;
}

async function pdfTexts(bytes: Uint8Array): Promise<string[]> {
  const proxy = await getDocumentProxy(bytes);
  const extracted = await extractText(proxy, { mergePages: false });
  return extracted.text;
}

async function imageBytesForModel(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
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

async function transcribeFile(
  bytes: Uint8Array,
  mime: string,
  pageCount: number,
  texts: string[],
): Promise<PageRead[]> {
  const reads: PageRead[] = Array.from({ length: pageCount }, (_, index) => {
    const text = (texts[index] ?? "").trim();
    return { text, needsReview: false };
  });

  const sparse = reads
    .map((page, index) => ({ index, words: countWords(page.text) }))
    .filter((page) => page.words < SPARSE_PAGE_WORDS)
    .map((page) => page.index + 1);

  if (sparse.length === 0) return reads;

  try {
    const file =
      mime === "application/pdf" ? { bytes, mime } : await imageBytesForModel(bytes, mime);
    const result = await generateObject(ocrSchema, [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Transcribe the requested pages into plain text. Preserve names, dates, and place names exactly as spelled. If a page is blank or unreadable, set unreadable true and text to an empty string. Requested page numbers: ${sparse.join(", ")}.`,
          },
          { type: "file", mediaType: file.mime, data: file.bytes },
        ],
      },
    ]);
    for (const page of result.pages) {
      const index = Math.round(page.pageNumber) - 1;
      if (index < 0 || index >= reads.length) continue;
      const text = page.text.trim();
      const unreadable = page.unreadable || countWords(text) === 0;
      reads[index] = { text, needsReview: unreadable || clamp01(page.confidence) < 0.5 };
    }
    for (const pageNumber of sparse) {
      const index = pageNumber - 1;
      if (!result.pages.some((page) => Math.round(page.pageNumber) === pageNumber)) {
        reads[index] = { text: reads[index]?.text ?? "", needsReview: true };
      }
    }
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    for (const pageNumber of sparse) {
      reads[pageNumber - 1] = { text: reads[pageNumber - 1]?.text ?? "", needsReview: true };
    }
  }

  return reads;
}

async function readFields(text: string) {
  const sample = text.slice(0, 8000);
  if (!sample.trim()) return null;
  try {
    return await generateObject(readingSchema, [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Read this document for a certified translation into English.
Return ISO 639-1 language and a confidence from 0 to 1.
Extract only what is printed. Use an empty string when a field is absent. Do not invent names.
full_name: the person's full name as spelled. If several people are named, join them with "; ".
date_of_birth: the date of birth as written.
parent_names: the parents' names as spelled, joined with "; ".
place_of_birth: the place of birth as spelled.
date_format: MM/DD/YYYY or DD/MM/YYYY if the dates on the page show which order is used, otherwise empty.

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

export async function analyzeOrder(db: Db, orderId: string): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order || order.languageConfirmed) return;
  if (order.status !== "draft" && order.status !== "failed") return;

  const documents = await claimDocuments(db, orderId);
  if (documents.length === 0) return;

  try {
    const files: SourceFile[] = [];
    const originals: Array<{ document: DocumentRecord; bytes: Uint8Array }> = [];
    for (const document of documents) {
      const bytes = await downloadObject(db, "originals", document.originalPath);
      const mime = document.mime ?? "application/octet-stream";
      files.push({ bytes, mime });
      originals.push({ document, bytes });
    }

    const combined = await buildCombinedOriginal(files);
    const combinedPath = `${orderId}/original-combined.pdf`;
    await uploadObject(db, "originals", combinedPath, combined.pdf, "application/pdf");

    const extractedFields: Array<{ documentId: string; fieldKey: string; originalValue: string | null }> = [];
    const languages: string[] = [];
    const confidences: number[] = [];
    let missedDetection = false;
    const pageBillable: number[] = [];
    const pageNeedsReview: boolean[] = [];

    for (let index = 0; index < originals.length; index += 1) {
      const { document, bytes } = originals[index];
      const mime = document.mime ?? "application/pdf";
      const pageMeta = combined.pages.filter((page) => page.sourceIndex === index);
      const layer = mime === "application/pdf" ? await pdfTexts(bytes) : [];
      const reads = await transcribeFile(bytes, mime, pageMeta.length, layer);
      const joined = reads.map((page) => page.text).filter(Boolean).join("\n");
      const reading = await readFields(joined);
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
          documentId: document.id,
          fieldKey,
          originalValue: values[fieldKey],
        });
      }

      const cjk = isCjkBillingLanguage(language);
      await replacePages(
        db,
        document.id,
        pageMeta.map((page, pageIndex) => {
          const read = reads[pageIndex] ?? { text: "", needsReview: true };
          const words = countWords(read.text);
          const counted = cjk ? countCjkUnits(read.text) : words;
          const billed = cjk ? billableCjkUnits(counted) : billableUnits(words);
          pageBillable.push(billed);
          pageNeedsReview.push(read.needsReview);
          return {
            pageNumber: page.sourcePage,
            wordCount: counted,
            billableUnits: billed,
            billingBasis: cjk ? ("cjk" as const) : ("words" as const),
            ocrText: read.text,
            needsReview: read.needsReview,
            widthPt: page.widthPt,
            heightPt: page.heightPt,
          };
        }),
      );

      await updateDocument(db, document.id, {
        status: "ready",
        page_count: pageMeta.length,
        detected_language: language,
        confidence,
      });
    }

    const distinct = [...new Set(languages)];
    const decision = decideQuote({
      billableUnits: pageBillable,
      pageNeedsReview,
      language: distinct[0] ?? null,
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      detectionAvailable: !missedDetection && distinct.length > 0,
      languagesDisagree: distinct.length > 1,
    });

    await replaceExtractedConfirmations(db, orderId, extractedFields);
    await updateOrder(db, orderId, {
      status: decision.status,
      source_language: distinct.length === 1 ? distinct[0] : null,
      billable_pages: decision.billablePages,
      total_cents: decision.totalCents,
      review_reason: decision.reviewReason,
      eta_at: etaFromNow(decision.etaHours),
      combined_original_path: combinedPath,
    });

    if (decision.status === "quoted" && !(await hasEvent(db, orderId, "quote_shown"))) {
      await insertEvent(db, orderId, "quote_shown", {
        billablePages: decision.billablePages,
        totalCents: decision.totalCents,
      });
    }
  } catch (error) {
    await markDocuments(db, orderId, "failed");
    const message = error instanceof Error ? error.message : "We could not read the upload.";
    console.error(`analysis failed for ${orderId}: ${message}`);
    await updateOrder(db, orderId, {
      status: "needs_review",
      review_reason: message,
      eta_at: etaFromNow(24),
    });
  }
}

export async function documentsForOrder(db: Db, orderId: string) {
  return listDocuments(db, orderId);
}
