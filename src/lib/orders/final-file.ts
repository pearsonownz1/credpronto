import type { DownloadDecision } from "./access";
import { FINALS_BUCKET, ORIGINALS_BUCKET } from "./constants";
import { listDocuments, listPages, listTranslations, type Db } from "./db";
import { deliveryDocumentName, detectDocumentTitle, orderDownloadFilename } from "./download-name";
import { inReadingOrder } from "./page-order";
import { buildCombinedOriginal, type SourceFile } from "./pdf/combine";
import { appendPdf, concatPdfs, mergeCertifiedPacket } from "./pdf/merge";
import { pdfPageCount, stampPacketPageNumbers } from "./pdf/page-numbers";
import type { QaSignal } from "./release-decision";
import { orderHasEvaluation } from "./service-selection";
import { downloadObject, uploadObject } from "./storage";
import type { DocumentRecord, OrderRecord } from "./types";
import { stampFinishedPdf } from "./verification";

const PDF_TYPE = "application/pdf";

/** One object in the private finals bucket. Both order columns point at it. */
export function certifiedTranslationObjectPath(orderId: string, version: number): string {
  return `${orderId}/certified-translation-v${version}.pdf`;
}

const CERTIFIED_TRANSLATION_OBJECT = /\/certified-translation-v\d+\.pdf$/;

/** The clean translation packet, not an evaluation report stored in the same column. */
export function isCertifiedTranslationPath(path: string | null | undefined): path is string {
  return typeof path === "string" && CERTIFIED_TRANSLATION_OBJECT.test(path);
}

export type BundleTranslationInput = {
  includeTranslation?: boolean | null;
  status?: string | null;
  paymentStatus?: string | null;
  finalTranslationPath?: string | null;
  certificationPath?: string | null;
  reviewReason?: string | null;
  qa?: QaSignal | null;
  languageConfidence?: number | null;
  pageNeedsReview?: boolean;
  openCorrections?: boolean;
  /** Defaults to AUTO_RELEASE_ENABLED, same as a translation-only order. */
  enabled?: boolean;
  deliveryStatus?: string | null;
  /**
   * File on the delivery row. Staff approval of the translation copies the
   * certified packet here. The evaluation report is a different file.
   */
  deliveryFinalPath?: string | null;
};

function bundleSettled(order: BundleTranslationInput): boolean {
  return (
    order.status === "paid" ||
    order.status === "approved" ||
    order.status === "delivered" ||
    order.paymentStatus === "paid" ||
    order.paymentStatus === "paid_test"
  );
}

/**
 * Evaluation bundles are one package: the certified translation stays locked
 * until the whole order is approved or delivered, then ships with the report.
 */
export function bundleTranslationReady(order: BundleTranslationInput): boolean {
  if (order.includeTranslation !== true || !isCertifiedTranslationPath(order.finalTranslationPath)) return false;
  if (!bundleSettled(order)) return false;
  // One package: nothing downloads until the whole order is approved or delivered.
  return order.status === "approved" || order.status === "delivered";
}

/** Download API status for that same check. Unpaid is 402. A hold is 403. */
export function bundleTranslationDecision(order: BundleTranslationInput): DownloadDecision {
  if (!bundleSettled(order)) return { ok: false, status: 402, error: "Payment required" };
  if (!bundleTranslationReady(order)) {
    return { ok: false, status: 403, error: "Certification is not approved" };
  }
  return { ok: true };
}

/**
 * Cover and translation are already one PDF. Append the original pages when
 * they can be read. A missing original still stores the certified translation.
 */
export async function storeCertifiedTranslation(
  db: Db,
  input: {
    orderId: string;
    version: number;
    cleanTranslation: Uint8Array;
    combinedOriginalPath: string | null;
    /** GCS keeps the certificate layout and does not append the original. */
    appendOriginal?: boolean;
    /** GCS does not add the CredPronto verification band. */
    stampVerification?: boolean;
  },
): Promise<string> {
  const appendOriginal = input.appendOriginal !== false;
  const stampVerification = input.stampVerification !== false;
  let prepared = input.cleanTranslation;
  if (appendOriginal) {
    const documents = inReadingOrder(await listDocuments(db, input.orderId));
    const original = await loadOriginalPdf(db, {
      combinedOriginalPath: input.combinedOriginalPath,
      documents,
    });
    if (original) {
      const footerPages = await pdfPageCount(input.cleanTranslation);
      prepared = await stampPacketPageNumbers(await appendPdf(input.cleanTranslation, original), {
        orderId: input.orderId,
        footerPages,
      });
    }
  }
  const bytes = stampVerification
    ? await stampFinishedPdf(db, prepared, {
        orderId: input.orderId,
        documentType: "translation",
      })
    : prepared;
  const path = certifiedTranslationObjectPath(input.orderId, input.version);
  await uploadObject(db, FINALS_BUCKET, path, bytes, PDF_TYPE);
  return path;
}

export async function resolveCustomerFinal(
  db: Db,
  order: OrderRecord,
  delivery: { finalPath: string | null; certificationPath: string | null },
): Promise<{ path: string; filename: string } | null> {
  const documents = inReadingOrder(await listDocuments(db, order.id));
  const names = documents.map((document) => document.filename);
  const evaluation = orderHasEvaluation(order);
  const filename = evaluation
    ? orderDownloadFilename("evaluation", names, order.targetLanguage)
    : deliveryDocumentName({
        detectedTitle: await detectedTitle(db, documents),
        documentNames: names,
      }).filename;

  const finalPath = delivery.finalPath;
  const certPath = delivery.certificationPath;
  const path = finalPath || certPath;
  if (!path) return null;
  if (!finalPath || !certPath || finalPath === certPath) return { path, filename };

  try {
    const [main, certification] = await Promise.all([
      downloadObject(db, FINALS_BUCKET, finalPath),
      downloadObject(db, FINALS_BUCKET, certPath),
    ]);
    const merged = evaluation
      ? await concatPdfs([certification, main])
      : await mergeCertifiedPacket({
          certification,
          translation: main,
          original: await loadOriginalPdf(db, {
            combinedOriginalPath: order.combinedOriginalPath,
            documents,
          }),
          orderId: order.id,
        });
    const stored = `${order.id}/${evaluation ? "evaluation-merged.pdf" : "certified-translation.pdf"}`;
    await uploadObject(db, FINALS_BUCKET, stored, merged, PDF_TYPE);
    return { path: stored, filename };
  } catch (error) {
    console.error(error instanceof Error ? error.message : "final merge failed");
    return { path, filename };
  }
}

async function detectedTitle(db: Db, documents: DocumentRecord[]): Promise<string | null> {
  const [pages, translations] = await Promise.all([
    listPages(
      db,
      documents.map((document) => document.id),
    ),
    listTranslations(
      db,
      documents.map((document) => document.id),
    ),
  ]);
  return detectDocumentTitle({
    outputs: translations.map((translation) => translation.output),
    ocrTexts: pages.map((page) => page.ocrText),
  });
}

function storageReady(db: Db): boolean {
  const storage = (db as { storage?: { from?: unknown } }).storage;
  return typeof storage?.from === "function";
}

/** Combined original when it is stored, otherwise one PDF built from the uploads. */
export async function loadOriginalPdf(
  db: Db,
  input: { combinedOriginalPath: string | null; documents: DocumentRecord[] },
): Promise<Uint8Array | null> {
  if (!storageReady(db)) return null;
  if (input.combinedOriginalPath) {
    try {
      return await downloadObject(db, ORIGINALS_BUCKET, input.combinedOriginalPath);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "combined original unavailable");
    }
  }
  if (input.documents.length === 0) return null;
  try {
    const files: SourceFile[] = [];
    for (const document of input.documents) {
      const bytes = await downloadObject(db, ORIGINALS_BUCKET, document.originalPath);
      files.push({ bytes, mime: document.mime || PDF_TYPE });
    }
    return (await buildCombinedOriginal(files)).pdf;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "original pages unavailable");
    return null;
  }
}
