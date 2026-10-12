import { FINALS_BUCKET } from "./constants";
import {
  customerEmail,
  listConfirmations,
  listDocuments,
  listPages,
  type Db,
} from "./db";
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

/** Rewrite the cover with the approving staff member. The translated pages stay. */
export async function stampApprovedCover(db: Db, order: OrderRecord, approverName: string | null): Promise<void> {
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
  const clean = await replaceCoverPage(existing, cover);
  await uploadObject(db, FINALS_BUCKET, order.certificationPath, cover, "application/pdf");
  await uploadObject(db, FINALS_BUCKET, order.finalTranslationPath, clean, "application/pdf");
}
