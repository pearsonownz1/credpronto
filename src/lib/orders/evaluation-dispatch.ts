import { FINALS_BUCKET } from "./constants";
import { listDocuments, listPages, settledPayment, updateOrder, getOrderById, type Db } from "./db";
import { HttpError } from "./errors";
import { evaluateServiceFromText } from "./evaluation";
import { progressWithEvaluationFailures } from "./evaluation-failures";
import {
  evaluationServicePath,
  evaluationSummaries,
  orderIsPaid,
  paidEvaluationDegreeCount,
  paidEvaluationPatch,
  pendingEvaluationWork,
  type ProducedEvaluation,
} from "./evaluation-summary";
import {
  courseExtractFromTranscript,
  textForPaidEvaluation,
  type TranscriptRowFailure,
} from "./evaluation-transcript";
import { evaluationIssuedLabel, evaluationReportId, renderEvaluationPdfs } from "./pdf/evaluation";
import { orderEvaluationKinds, orderHasEvaluation } from "./service-selection";
import { requireStaff } from "./staff";
import { uploadObject } from "./storage";
import type { EvaluationResult, EvaluationService, OrderRecord } from "./types";
import { stampFinishedPdf } from "./verification";

export type EvaluationFailure = {
  service: EvaluationService;
  reason: string;
};

export type EnsureEvaluationsResult = {
  status: "ready" | "partial" | "unchanged";
  generated: EvaluationService[];
  pending: EvaluationService[];
  failures: EvaluationFailure[];
};

const UNCHANGED: EnsureEvaluationsResult = { status: "unchanged", generated: [], pending: [], failures: [] };

function unreadReason(service: EvaluationService): string {
  return service === "course_by_course"
    ? "Course-by-course evaluation could not be read from the uploaded pages."
    : "Diploma evaluation could not be read from the uploaded pages.";
}

export type EvaluationProduce =
  | EvaluationResult
  | null
  | { result: EvaluationResult | null; failures?: readonly TranscriptRowFailure[] };

export type EvaluationDispatchDeps = {
  produce: (
    db: Db,
    order: OrderRecord,
    service: EvaluationService,
    pageText: string,
    filenames: string[],
  ) => Promise<EvaluationProduce>;
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
  if (!order || !orderIsPaid(order) || !orderHasEvaluation(order)) return UNCHANGED;

  const initial = pendingEvaluationWork(order);
  if (initial.length === 0) {
    const kept = await transcriptRowFailures(db, order);
    const progress = progressWithEvaluationFailures(order.progress, kept);
    if (progress) await updateOrder(db, order.id, { progress });
    return { ...UNCHANGED, failures: kept };
  }

  const documents = await listDocuments(db, order.id);
  const pages = await listPages(
    db,
    documents.map((document) => document.id),
  );
  const filenames = documents.map((document) => document.filename);
  const produced: ProducedEvaluation[] = [];
  const generated: EvaluationService[] = [];
  const failures: EvaluationFailure[] = [];
  let current = order;

  for (const gap of initial) {
    try {
      const degreeCount = paidEvaluationDegreeCount(current);
      const counted = degreeCount == null ? current : { ...current, degreeCount };
      const text = textForPaidEvaluation(documents, pages, gap.service);
      const existing =
        current.evaluationResults?.find((result) => result.kind === gap.service) ??
        (current.evaluationResult?.kind === gap.service ? current.evaluationResult : null);
      const result = gap.needsResult
        ? await readPaidEvaluation(deps, db, counted, gap.service, text, filenames)
        : existing
          ? { ok: true as const, result: existing, failures: [] }
          : { ok: false as const, reason: "The stored evaluation result is missing.", failures: [] };
      for (const failure of result.failures) {
        console.error(`${failure.service}: ${failure.reason}`);
        failures.push(failure);
      }
      if (!result.ok) {
        console.error(`${gap.service}: ${result.reason}`);
        failures.push({ service: gap.service, reason: result.reason });
        continue;
      }
      if (gap.needsFile) {
        const stored = await deps.store(db, counted, gap.service, result.result);
        produced.push({ service: gap.service, result: stored.result, path: stored.path });
      } else {
        produced.push({
          service: gap.service,
          result: result.result,
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
      const reason = error instanceof Error && error.message ? error.message : "evaluation report failed";
      console.error(`${gap.service}: ${reason}`);
      failures.push({ service: gap.service, reason });
    }
  }

  const savedFailures = withTranscriptRows(order, documents, pages, failures);
  const patch = paidEvaluationPatch(order, produced) ?? {};
  const progress = progressWithEvaluationFailures(order.progress, savedFailures);
  if (progress) patch.progress = progress;
  if (Object.keys(patch).length > 0) await updateOrder(db, order.id, patch);
  const pending = pendingEvaluationWork({
    ...order,
    evaluationResult: (patch?.evaluation_result as EvaluationResult | undefined) ?? order.evaluationResult,
    evaluationResults: (patch?.evaluation_results as EvaluationResult[] | undefined) ?? order.evaluationResults,
    serviceFiles: (patch?.service_files as OrderRecord["serviceFiles"] | undefined) ?? order.serviceFiles,
  }).map((gap) => gap.service);

  if (pending.length > 0) return { status: "partial", generated, pending, failures: savedFailures };
  if (generated.length === 0) return { status: "unchanged", generated, pending, failures: savedFailures };
  return { status: "ready", generated, pending, failures: savedFailures };
}

function unpackProduce(value: EvaluationProduce): { result: EvaluationResult | null; failures: TranscriptRowFailure[] } {
  if (!value || typeof value !== "object") return { result: null, failures: [] };
  if ("kind" in value) return { result: value, failures: [] };
  const failures = Array.isArray(value.failures)
    ? value.failures.flatMap((entry) => {
        const row = entry?.row?.trim() ?? "";
        const reason = entry?.reason?.trim() ?? "";
        return row && reason ? [{ row, reason }] : [];
      })
    : [];
  const result = value.result && typeof value.result === "object" && "kind" in value.result ? value.result : null;
  return { result, failures };
}

function storedRowFailure(service: EvaluationService, failure: TranscriptRowFailure): EvaluationFailure {
  return { service, reason: `${failure.row}: ${failure.reason}` };
}

function withTranscriptRows(
  order: OrderRecord,
  documents: readonly { id: string; position: number }[],
  pages: readonly { documentId: string; pageNumber: number; ocrText: string | null }[],
  failures: readonly EvaluationFailure[],
): EvaluationFailure[] {
  if (!orderEvaluationKinds(order).includes("course_by_course")) return [...failures];
  const rows = courseExtractFromTranscript(textForPaidEvaluation(documents, pages, "course_by_course")).failures.map(
    (failure) => storedRowFailure("course_by_course", failure),
  );
  const seen = new Set(failures.map((failure) => `${failure.service}:${failure.reason}`));
  return [...failures, ...rows.filter((failure) => !seen.has(`${failure.service}:${failure.reason}`))];
}

/** Row reasons from the transcript parser, kept on the order after the report exists. */
async function transcriptRowFailures(db: Db, order: OrderRecord): Promise<EvaluationFailure[]> {
  const documents = await listDocuments(db, order.id);
  const pages = await listPages(
    db,
    documents.map((document) => document.id),
  );
  return withTranscriptRows(order, documents, pages, []);
}

async function readPaidEvaluation(
  deps: EvaluationDispatchDeps,
  db: Db,
  order: OrderRecord,
  service: EvaluationService,
  text: string,
  filenames: string[],
): Promise<
  | { ok: true; result: EvaluationResult; failures: EvaluationFailure[] }
  | { ok: false; reason: string; failures: EvaluationFailure[] }
> {
  if (service === "diploma" && order.degreeCount == null) {
    return { ok: false, reason: "Diploma evaluation needs a credential count before it can be generated.", failures: [] };
  }
  if (!text.trim()) return { ok: false, reason: "This order has no page text to read for the evaluation.", failures: [] };
  const produced = unpackProduce(await deps.produce(db, order, service, text, filenames));
  const failures = produced.failures.map((failure) => storedRowFailure(service, failure));
  if (!produced.result) return { ok: false, reason: unreadReason(service), failures };
  return { ok: true, result: produced.result, failures };
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
