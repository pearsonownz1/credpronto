import { z } from "zod";
import { generateObject, translationModelId } from "./ai";
import { CONFIRMATION_FIELD_KEYS } from "./fields";
import { renderOrderPdfs, type RenderPage } from "./pdf/render";
import {
  customerEmail,
  getOrderById,
  insertEvent,
  insertPreview,
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
import { HttpError } from "./errors";
import { uploadObject } from "./storage";
import type { ConfirmationRecord, CorrectionRecord, PageRecord } from "./types";

const translationSchema = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number(),
      paragraphs: z.array(z.string()),
    }),
  ),
});

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

function alignPages(
  expected: number[],
  returned: Array<{ pageNumber: number; paragraphs: string[] }>,
): Array<{ pageNumber: number; paragraphs: string[] }> | null {
  const byNumber = new Map<number, string[]>();
  for (const page of returned) {
    const paragraphs = page.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
    byNumber.set(Math.round(page.pageNumber), paragraphs);
  }
  if (expected.every((number) => byNumber.has(number))) {
    return expected.map((number) => ({
      pageNumber: number,
      paragraphs: byNumber.get(number)?.length ? byNumber.get(number)! : [" "],
    }));
  }
  if (returned.length === expected.length) {
    return expected.map((number, index) => {
      const paragraphs = returned[index]?.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
      return { pageNumber: number, paragraphs: paragraphs?.length ? paragraphs : [" "] };
    });
  }
  return null;
}

async function translateDocument(input: {
  filename: string;
  sourceLanguage: string;
  fields: ConfirmationRecord[];
  pages: Array<PageRecord & { number: number }>;
  corrections: CorrectionRecord[];
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

  const prompt = `Translate this document into English, one original page to one translated page.
Source language: ${input.sourceLanguage}.
File: ${input.filename}.

Use these confirmed spellings exactly whenever the person, the parents, the birthplace, or the date of birth appears. Do not invent a name that was confirmed as absent.
Write every date in the translation, including the date of birth, using this format: ${dateFormatOf(input.fields)}.

Confirmed fields:
${confirmedBlock(input.fields)}

${notes.length ? `The customer asked for these corrections:\n${notes.join("\n")}` : "There are no correction notes."}

Return paragraphs of English for each page number listed below. Keep page numbers unchanged.
${pageText}`;

  const expected = input.pages.map((page) => page.number);
  let last: Array<{ pageNumber: number; paragraphs: string[] }> = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await generateObject(translationSchema, [
      { role: "user", content: [{ type: "text", text: prompt }] },
    ]);
    last = result.pages;
    const aligned = alignPages(expected, result.pages);
    if (aligned) return aligned;
  }
  const fallback = alignPages(expected, last);
  if (fallback) return fallback;
  throw new HttpError("The translation did not return every page.", 502);
}

export async function translateOrder(db: Db, orderId: string, token: string | null): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    const order = await getOrderById(db, orderId);
    if (!order) return;
    const open = (await listCorrections(db, orderId)).filter((correction) => correction.status === "open");
    if (order.status === "preview_ready" && open.length === 0) return;
    if (order.status === "paid" || order.status === "approved" || order.status === "delivered" || order.status === "cancelled") {
      return;
    }
    if (!order.languageConfirmed || !order.sourceLanguage) {
      throw new HttpError("Confirm the language and the name fields before translation.", 409);
    }

    const claim = await db
      .from("orders")
      .update({ status: "processing" })
      .eq("id", orderId)
      .in("status", ["confirmed", "correction_requested", "failed", "preview_ready", "processing"])
      .select("id");
    if (claim.error) throw new Error(claim.error.message);
    if ((claim.data ?? []).length === 0) return;

    const documents = await listDocuments(db, orderId);
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
              paragraphs: page.paragraphs,
            })),
          },
        });
        for (const page of translated) {
          const source = documentPages.find((item) => item.number === page.pageNumber);
          renderedPages.push({
            combinedPageNumber: page.pageNumber,
            widthPt: source?.widthPt ?? 612,
            heightPt: source?.heightPt ?? 792,
            paragraphs: page.paragraphs,
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
      await markPreview(db, orderId, version, "ready");
      await resolveCorrections(db, open.map((correction) => correction.id), version);
      await updateOrder(db, orderId, {
        final_translation_path: translationPath,
        certification_path: certificationPath,
      });

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
      const message = error instanceof Error ? error.message : "Translation failed.";
      await updateOrder(db, orderId, { status: "failed", review_reason: message });
      throw error;
    }
  }
}
