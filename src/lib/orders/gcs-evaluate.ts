import {
  FINALS_BUCKET,
  LETTER_HEIGHT_PT,
  LETTER_WIDTH_PT,
  PREVIEWS_BUCKET,
  PREVIEW_URL_SECONDS,
} from "./constants";
import { listDocuments, listPages, listTranslations, updateOrder } from "./db";
import { HttpError } from "./errors";
import { evaluateServiceFromText, type ServiceFromText } from "./evaluation";
import { textForPaidEvaluation } from "./evaluation-transcript";
import { evaluationServicePath, storedEvaluationFile } from "./evaluation-summary";
import { isGcsOrder } from "./gcs";
import { orderForToken } from "./order-access";
import { evaluationIssuedLabel, evaluationReportId, renderEvaluationPdfs } from "./pdf/evaluation";
import { signedObjectUrl, uploadObject, type Db } from "./storage";
import type { EvaluationResult, EvaluationService, OrderRecord, PageRecord, TranslationRecord } from "./types";
import { stampFinishedPdf } from "./verification";

/** OCR shorter than this is treated as sparse and combined with the translation. */
const SPARSE_EVALUATION_CHARS = 40;

export type GcsEvaluationBody = {
  url: string;
  pageCount: number;
  pages: Array<{ number: number; widthPt: number; heightPt: number }>;
  kind: EvaluationService;
};

export type GcsEvaluationPayload = {
  evaluation: GcsEvaluationBody;
};

function letterPages(count: number): GcsEvaluationBody["pages"] {
  const total = Math.max(1, count);
  return Array.from({ length: total }, (_, index) => ({
    number: index + 1,
    widthPt: LETTER_WIDTH_PT,
    heightPt: LETTER_HEIGHT_PT,
  }));
}

function translationParagraphs(translations: readonly TranslationRecord[]): string {
  const chunks: string[] = [];
  for (const translation of translations) {
    const output = translation.output;
    if (!output || typeof output !== "object") continue;
    const pages = (output as { pages?: unknown }).pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      if (!page || typeof page !== "object") continue;
      const paragraphs = (page as { paragraphs?: unknown }).paragraphs;
      if (!Array.isArray(paragraphs)) continue;
      for (const paragraph of paragraphs) {
        if (typeof paragraph === "string" && paragraph.trim()) chunks.push(paragraph.trim());
      }
    }
  }
  return chunks.join("\n");
}

/**
 * Course-by-course reads transcript OCR. A short or empty read also uses every
 * page's OCR and the certified translation, which is what a diploma scan often has.
 */
export function gcsEvaluationSourceText(input: {
  documents: readonly { id: string; position: number }[];
  pages: readonly PageRecord[];
  translations: readonly TranslationRecord[];
}): string {
  const selected = textForPaidEvaluation(input.documents, input.pages, "course_by_course").trim();
  const ocr = [...input.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => page.ocrText?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  const translated = translationParagraphs(input.translations);
  const fallback = [ocr, translated].filter((part) => part.length > 0).join("\n\n").trim();
  if (selected.length >= SPARSE_EVALUATION_CHARS) return selected;
  return fallback.length > selected.length ? fallback : selected;
}

function courseHasRows(result: EvaluationResult | null): boolean {
  if (!result || result.kind !== "course_by_course") return false;
  return result.years.some((year) => year.courses.length > 0);
}

function pageCountFor(order: OrderRecord, kind: EvaluationService): number {
  const matches = [order.evaluationResult, ...(order.evaluationResults ?? [])].filter(
    (item): item is EvaluationResult => item?.kind === kind,
  );
  const count = matches.find((item) => (item.pageCount ?? 0) > 0)?.pageCount;
  return count && count > 0 ? count : 1;
}

function previewCopyPath(orderId: string): string {
  return `${orderId}/gcs-evaluation-v1.pdf`;
}

async function signedEvaluation(
  db: Db,
  path: string,
  pageCount: number,
  kind: EvaluationService,
): Promise<GcsEvaluationPayload> {
  const count = pageCount > 0 ? pageCount : 1;
  const url = await signedObjectUrl(db, FINALS_BUCKET, path, PREVIEW_URL_SECONDS);
  return {
    evaluation: {
      url,
      pageCount: count,
      pages: letterPages(count),
      kind,
    },
  };
}

async function publishEvaluation(
  db: Db,
  order: OrderRecord,
  result: EvaluationResult,
  built?: ServiceFromText,
): Promise<GcsEvaluationPayload> {
  const files = await renderEvaluationPdfs(result, {
    reportId: evaluationReportId(order.id),
    issued: evaluationIssuedLabel(order.createdAt),
    degreeCount: order.degreeCount ?? 1,
    detectedPages: order.billablePages,
  });
  const stamped = await stampFinishedPdf(db, files.clean, {
    orderId: order.id,
    documentType: "evaluation",
  });
  const cleanPath = evaluationServicePath(order.id, result.kind);
  await uploadObject(db, FINALS_BUCKET, cleanPath, stamped, "application/pdf");
  await uploadObject(db, PREVIEWS_BUCKET, previewCopyPath(order.id), stamped, "application/pdf");
  const stored: EvaluationResult = { ...result, pageCount: files.pageCount };
  const patch: Record<string, unknown> = {
    evaluation_result: stored,
    evaluation_results: [stored],
    service_files: { ...(order.serviceFiles ?? {}), [result.kind]: cleanPath },
  };
  if (built?.edgeCredentialId) patch.edge_credential_id = built.edgeCredentialId;
  if (built?.edgeGradingScaleId) patch.edge_grading_scale_id = built.edgeGradingScaleId;
  if (built?.edgeMatchMethod) patch.edge_match_method = built.edgeMatchMethod;
  await updateOrder(db, order.id, patch);
  return signedEvaluation(db, cleanPath, files.pageCount, result.kind);
}

/**
 * Free GCS evaluation. A stored finals PDF is signed and returned.
 * A stored result with no file is rendered again. Otherwise the page text is
 * read as a transcript, then as a diploma when that transcript has no courses.
 */
export async function evaluateGcsOrder(token: string): Promise<GcsEvaluationPayload> {
  const { db, order } = await orderForToken(token);
  if (!isGcsOrder(order)) throw new HttpError("Evaluation is not available for this order", 403);
  if (order.status === "cancelled" || order.status === "failed") {
    throw new HttpError("This translation is not ready to evaluate", 409);
  }

  const existing = storedEvaluationFile(order.serviceFiles);
  if (existing) {
    return signedEvaluation(db, existing.path, pageCountFor(order, existing.kind), existing.kind);
  }

  if (order.evaluationResult) {
    return publishEvaluation(db, order, order.evaluationResult);
  }

  const documents = await listDocuments(db, order.id);
  const documentIds = documents.map((document) => document.id);
  const [pages, translations] = await Promise.all([
    listPages(db, documentIds),
    listTranslations(db, documentIds),
  ]);
  const text = gcsEvaluationSourceText({ documents, pages, translations });
  if (!text.trim()) throw new HttpError("This document does not have enough text to evaluate", 422);

  const filenames = documents.map((document) => document.filename);
  const courseOrder: OrderRecord = {
    ...order,
    degreeCount: order.degreeCount ?? 1,
    service: "course_by_course",
    services: ["course_by_course"],
  };
  const course = await evaluateServiceFromText(db, courseOrder, "course_by_course", text, filenames);
  let built = course;
  if (!courseHasRows(course.result)) {
    const diplomaOrder: OrderRecord = {
      ...order,
      degreeCount: order.degreeCount ?? 1,
      service: "diploma",
      services: ["diploma"],
    };
    built = await evaluateServiceFromText(db, diplomaOrder, "diploma", text, filenames);
  }
  if (!built.result) throw new HttpError("This document could not be evaluated", 422);
  return publishEvaluation(db, order, built.result, built);
}
