import { requireStaff } from "./staff";
import {
  getDelivery,
  getOrderById,
  insertEvent,
  insertPreview,
  insertTranslation,
  listDocuments,
  listPages,
  listTranslations,
  markPreview,
  nextPreviewVersion,
  nextTranslationVersion,
  updateDelivery,
  updateOrder,
  withCombinedNumbers,
} from "./db";
import { HttpError } from "./errors";
import { renderOrderPdfs } from "./pdf/render";
import { uploadObject } from "./storage";
import { mergeEditedPages, paragraphsForPage, type PageEdit, type PageTranslation } from "./translation-edit";

const EDITABLE = new Set(["preview_ready", "correction_requested", "paid", "approved", "delivered"]);

export function parseTranslationEdits(body: unknown): PageEdit[] {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const pages = (body as { pages?: unknown }).pages;
  if (!Array.isArray(pages) || pages.length === 0) throw new HttpError("pages is required", 400);

  return pages.map((entry) => {
    if (!entry || typeof entry !== "object") throw new HttpError("Invalid page edit", 400);
    const page = entry as { documentId?: unknown; pageNumber?: unknown; paragraphs?: unknown };
    if (typeof page.documentId !== "string" || page.documentId.length === 0) {
      throw new HttpError("documentId is required", 400);
    }
    if (typeof page.pageNumber !== "number" || !Number.isInteger(page.pageNumber) || page.pageNumber < 1) {
      throw new HttpError("pageNumber must be an integer starting at 1", 400);
    }
    if (!Array.isArray(page.paragraphs) || page.paragraphs.some((paragraph) => typeof paragraph !== "string")) {
      throw new HttpError("paragraphs must be an array of strings", 400);
    }
    return {
      documentId: page.documentId,
      pageNumber: page.pageNumber,
      paragraphs: page.paragraphs,
    };
  });
}

export async function editOrderTranslation(orderId: string, body: unknown) {
  const edits = parseTranslationEdits(body);
  const { db, userId } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (!EDITABLE.has(order.status)) {
    throw new HttpError("This order is not ready for a translation edit", 409);
  }
  if (!order.sourceLanguage) throw new HttpError("Set a source language before editing the translation", 409);

  const documents = await listDocuments(db, order.id);
  const pages = withCombinedNumbers(
    documents,
    await listPages(db, documents.map((document) => document.id)),
  );
  const translations = await listTranslations(db, documents.map((document) => document.id));
  const latest = new Map<string, (typeof translations)[number]>();
  for (const translation of translations) {
    if (translation.status !== "ready") continue;
    const current = latest.get(translation.documentId);
    if (!current || translation.version > current.version) latest.set(translation.documentId, translation);
  }

  const current: PageTranslation[] = pages.map((page) => {
    const translation = latest.get(page.documentId);
    return {
      documentId: page.documentId,
      pageNumber: page.pageNumber,
      combinedPageNumber: page.number,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      paragraphs: translation ? paragraphsForPage(translation.output, page) ?? [] : [],
    };
  });

  const merged = mergeEditedPages(current, edits);
  if (!merged.ok) throw new HttpError(merged.error, 400);

  const documentIds = documents.map((document) => document.id);
  const version = Math.max(
    await nextPreviewVersion(db, order.id),
    await nextTranslationVersion(db, documentIds),
  );
  const previewPath = `${order.id}/preview-v${version}.pdf`;
  const inserted = await insertPreview(db, { orderId: order.id, version, previewPath });
  if (inserted === "exists") throw new HttpError("That preview version already exists", 409);

  try {
    for (const document of documents) {
      const documentPages = pages.filter((page) => page.documentId === document.id);
      await insertTranslation(db, {
        documentId: document.id,
        version,
        model: "staff-edit",
        status: "ready",
        output: {
          pages: documentPages.map((page) => {
            const rendered = merged.pages.find((item) => item.combinedPageNumber === page.number);
            return {
              pageNumber: page.pageNumber,
              combinedPageNumber: page.number,
              paragraphs: rendered?.paragraphs ?? [],
            };
          }),
        },
      });
    }

    const files = await renderOrderPdfs({
      orderId: order.id,
      sourceLanguage: order.sourceLanguage,
      date: new Date().toISOString().slice(0, 10),
      pages: merged.pages,
    });
    const translationPath = `${order.id}/translation-v${version}.pdf`;
    const certificationPath = `${order.id}/certification-v${version}.pdf`;
    await uploadObject(db, "finals", translationPath, files.cleanTranslation, "application/pdf");
    await uploadObject(db, "finals", certificationPath, files.certification, "application/pdf");
    await uploadObject(db, "previews", previewPath, files.watermarkedPreview, "application/pdf");
    await markPreview(db, order.id, version, "ready");
    await updateOrder(db, order.id, {
      final_translation_path: translationPath,
      certification_path: certificationPath,
    });

    const delivery = await getDelivery(db, order.id);
    if (delivery && (delivery.status === "approved" || delivery.status === "delivered")) {
      await updateDelivery(db, order.id, {
        final_path: translationPath,
        certification_path: certificationPath,
      });
    }

    await insertEvent(db, order.id, "translation_edited", { version, editorId: userId });
    return { status: order.status, version, previewPath, translationPath, certificationPath };
  } catch (error) {
    await markPreview(db, order.id, version, "failed");
    throw error;
  }
}
