import { FINALS_BUCKET } from "./constants";
import { listDocuments, listPages, settledPayment, updateOrder, getOrderById, type Db } from "./db";
import { HttpError } from "./errors";
import { evaluateServiceFromText } from "./evaluation";
import {
  evaluationServicePath,
  evaluationSummaries,
  orderIsPaid,
  paidEvaluationPatch,
  pendingEvaluationWork,
  type ProducedEvaluation,
} from "./evaluation-summary";
import { evaluationIssuedLabel, evaluationReportId, renderEvaluationPdfs } from "./pdf/evaluation";
import { orderHasEvaluation } from "./service-selection";
import { requireStaff } from "./staff";
import { uploadObject } from "./storage";
import type { EvaluationResult, EvaluationService, OrderRecord } from "./types";
import { stampFinishedPdf } from "./verification";

export type EnsureEvaluationsResult = {
  status: "ready" | "partial" | "unchanged";
  generated: EvaluationService[];
  pending: EvaluationService[];
};

export type EvaluationDispatchDeps = {
  produce: (
    db: Db,
    order: OrderRecord,
    service: EvaluationService,
    pageText: string,
    filenames: string[],
  ) => Promise<EvaluationResult | null>;
  store: (
    db: Db,
    order: OrderRecord,
    service: EvaluationService,
    result: EvaluationResult,
  ) => Promise<{ result: EvaluationResult; path: string }>;
};

const defaultDeps: EvaluationDispatchDeps = {
  produce: (db, order, service, pageText, filenames) =>
    evaluateServiceFromText(db, order, service, pageText, filenames),
  store: (db, order, service, result) => storeEvaluationPdf(db, order, service, result),
};

async function storeEvaluationPdf(
  db: Db,
  order: OrderRecord,
  service: EvaluationService,
  result: EvaluationResult,
): Promise<{ result: EvaluationResult; path: string }> {
  const files = await renderEvaluationPdfs(result, {
    reportId: evaluationReportId(order.id),
    issued: evaluationIssuedLabel(order.createdAt),
    degreeCount: order.degreeCount,
    detectedPages: order.billablePages,
  });
  const stored: EvaluationResult = { ...result, pageCount: files.pageCount };
  const clean = await stampFinishedPdf(db, files.clean, { orderId: order.id, documentType: "evaluation" });
  const path = evaluationServicePath(order.id, service);
  await uploadObject(db, FINALS_BUCKET, path, clean, "application/pdf");
  return { result: stored, path };
}

function pageTextOf(pages: Array<{ pageNumber: number; ocrText: string | null }>): string {
  return [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => page.ocrText ?? "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds each purchased evaluation that is still missing. A second call leaves
 * finished reports in place and does not change the amount paid.
 */
export async function ensurePaidEvaluationReports(
  db: Db,
  orderId: string,
  deps: EvaluationDispatchDeps = defaultDeps,
): Promise<EnsureEvaluationsResult> {
  const order = await getOrderById(db, orderId);
  if (!order || !orderIsPaid(order) || !orderHasEvaluation(order)) {
    return { status: "unchanged", generated: [], pending: [] };
  }

  const initial = pendingEvaluationWork(order);
  if (initial.length === 0) return { status: "unchanged", generated: [], pending: [] };

  const documents = await listDocuments(db, order.id);
  const pages = await listPages(
    db,
    documents.map((document) => document.id),
  );
  const text = pageTextOf(pages);
  const filenames = documents.map((document) => document.filename);
  const produced: ProducedEvaluation[] = [];
  const generated: EvaluationService[] = [];
  let current = order;

  for (const gap of initial) {
    try {
      const existing = current.evaluationResults?.find((result) => result.kind === gap.service) ??
        (current.evaluationResult?.kind === gap.service ? current.evaluationResult : null);
      const result = gap.needsResult
        ? current.degreeCount == null
          ? null
          : await deps.produce(db, current, gap.service, text, filenames)
        : existing;
      if (!result) continue;
      if (gap.needsFile) {
        const stored = await deps.store(db, current, gap.service, result);
        produced.push({ service: gap.service, result: stored.result, path: stored.path });
      } else {
        produced.push({
          service: gap.service,
          result,
          path: current.serviceFiles?.[gap.service] ?? null,
        });
      }
      generated.push(gap.service);
      const patch = paidEvaluationPatch(current, produced.slice(-1));
      current = {
        ...current,
        evaluationResult: (patch?.evaluation_result as EvaluationResult | undefined) ?? current.evaluationResult,
        evaluationResults: (patch?.evaluation_results as EvaluationResult[] | undefined) ?? current.evaluationResults,
        serviceFiles:
          (patch?.service_files as OrderRecord["serviceFiles"] | undefined) ?? current.serviceFiles,
      };
    } catch (error) {
      console.error(error instanceof Error ? error.message : "evaluation report failed");
    }
  }

  const patch = paidEvaluationPatch(order, produced);
  if (patch) await updateOrder(db, order.id, patch);
  const pending = pendingEvaluationWork({
    ...order,
    evaluationResult: (patch?.evaluation_result as EvaluationResult | undefined) ?? order.evaluationResult,
    evaluationResults: (patch?.evaluation_results as EvaluationResult[] | undefined) ?? order.evaluationResults,
    serviceFiles: (patch?.service_files as OrderRecord["serviceFiles"] | undefined) ?? order.serviceFiles,
  }).map((gap) => gap.service);

  if (pending.length > 0) return { status: "partial", generated, pending };
  if (generated.length === 0) return { status: "unchanged", generated, pending };
  return { status: "ready", generated, pending };
}

/**
 * Staff re-run for a paid order. Safe to call again: finished reports stay,
 * and this never creates a payment.
 */
export async function regeneratePaidEvaluations(orderId: string): Promise<EnsureEvaluationsResult> {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (order.status === "cancelled") throw new HttpError("This order is cancelled", 409);
  if (!orderHasEvaluation(order)) throw new HttpError("This order is not an evaluation", 409);
  if (!orderIsPaid(order)) throw new HttpError("This order is not paid", 409);
  const payment = await settledPayment(db, order.id);
  if (!payment && !order.paidAt) throw new HttpError("This order is not paid", 409);
  return ensurePaidEvaluationReports(db, order.id);
}

export { evaluationSummaries };
