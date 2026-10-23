import { FINALS_BUCKET } from "./constants";
import {
  customerEmail,
  listConfirmations,
  listDocuments,
  listPages,
  updateOrder,
  type Db,
} from "./db";
import { loadOriginalPdf } from "./final-file";
import { appendPdf } from "./pdf/merge";
import { pdfPageCount, stampPacketPageNumbers } from "./pdf/page-numbers";
import {
  coverClientName,
  coverDocuments,
  coverSignature,
  coverTranslatorName,
  loadTranslatorSignature,
} from "./pdf/cover";
import { renderCertificationPdf, replaceCoverPage } from "./pdf/render";
import { downloadObject, uploadObject } from "./storage";
import type { OrderRecord } from "./types";
import { stampFinishedPdf } from "./verification";

/** Evaluations keep the credential report. Approval does not swap in a translation certificate. */
export function keepsEvaluationReport(order: { service: string | null }): boolean {
  return order.service != null;
}

export async function approverDisplayName(db: Db, userId: string): Promise<string | null> {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data.user) return null;
    const meta = data.user.user_metadata ?? {};
    const named = [meta.full_name, meta.display_name, meta.name].find(
      (value) => typeof value === "string" && value.trim() && !value.includes("@"),
    );
    return typeof named === "string" ? named.trim() : null;
  } catch {
    return null;
  }
}

/** Rewrite the cover. The signer is the owner signature. The translated pages stay. */
export async function stampApprovedCover(db: Db, order: OrderRecord, approverName: string | null): Promise<void> {
  if (keepsEvaluationReport(order)) return;
  if (!order.finalTranslationPath || !order.certificationPath || !order.sourceLanguage) return;
  const documents = await listDocuments(db, order.id);
  const pages = await listPages(db, documents.map((document) => document.id));
  const confirmations = await listConfirmations(db, order.id);
  const email = await customerEmail(db, order.customerId);
  const signature = coverSignature(approverName, loadTranslatorSignature());
  const cover = await renderCertificationPdf({
    orderId: order.id,
    sourceLanguage: order.sourceLanguage,
    targetLanguage: order.targetLanguage,
    date: new Date().toISOString().slice(0, 10),
    pages: pages.map((page, index) => ({
      combinedPageNumber: index + 1,
      widthPt: page.widthPt ?? 612,
      heightPt: page.heightPt ?? 792,
      paragraphs: [],
    })),
    clientName: coverClientName(confirmations, email),
    documents: coverDocuments(documents, pages),
    translatorName: coverTranslatorName(approverName),
    signature,
  });
  const existing = await downloadObject(db, FINALS_BUCKET, order.finalTranslationPath);
  let clean = await replaceCoverPage(existing, cover);
  const split = order.certificationPath !== order.finalTranslationPath;
  if (split) {
    const original = await loadOriginalPdf(db, {
      combinedOriginalPath: order.combinedOriginalPath,
      documents,
    });
    if (original) {
      const footerPages = await pdfPageCount(clean);
      clean = await stampPacketPageNumbers(await appendPdf(clean, original), {
        orderId: order.id,
        footerPages,
      });
    }
    clean = await stampFinishedPdf(db, clean, { orderId: order.id, documentType: "translation" });
    await uploadObject(db, FINALS_BUCKET, order.finalTranslationPath, clean, "application/pdf");
    // Leave the paths split when the original could not be read so the download can merge later.
    if (original || (!order.combinedOriginalPath && documents.length === 0)) {
      await updateOrder(db, order.id, { certification_path: order.finalTranslationPath });
      order.certificationPath = order.finalTranslationPath;
    }
    return;
  }
  const footerPages = 1 + pages.length;
  const total = await pdfPageCount(clean);
  if (total > footerPages) {
    clean = await stampPacketPageNumbers(clean, { orderId: order.id, footerPages });
  }
  clean = await stampFinishedPdf(db, clean, { orderId: order.id, documentType: "translation" });
  await uploadObject(db, FINALS_BUCKET, order.finalTranslationPath, clean, "application/pdf");
}
