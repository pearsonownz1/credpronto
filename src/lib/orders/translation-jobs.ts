import {
  getOrderById,
  insertPreview,
  latestReadyPreview,
  listConfirmations,
  listCorrections,
  listDocuments,
  listPages,
  markPreview,
  nextPreviewVersion,
  updateOrder,
  withCombinedNumbers,
  type Db,
} from "./db";
import { inReadingOrder } from "./page-order";
import type { RenderBlock } from "./pdf/layout";
import { blocksToParagraphs } from "./pdf/structure";
import type { QaIssue } from "./qa";
import type { ConfirmationRecord, CorrectionRecord, OrderRecord, PageRecord } from "./types";
import { decideTranslationFailure } from "./translation-failure";
import {
  TRANSLATION_ASSEMBLE_PATH,
  TRANSLATION_PAGE_PATH,
  dispatchTranslation,
} from "./translation-dispatch";
import {
  PAGE_ATTEMPT_LIMIT,
  TRANSLATION_JOB_STUCK_MS,
  TRANSLATION_PAGE_CONCURRENCY,
  isSkippedTranslationPage,
  jobsToDispatch,
  pageAttemptResult,
  pagesToTranslate,
} from "./translation-pages";
import { checkedProgress } from "./translation-watch";

type Row = Record<string, unknown>;

export type PageJobStatus = "pending" | "running" | "ready" | "failed";
export type TranslationRunStatus = "running" | "assembling" | "ready" | "failed";

export type PageJobOutput = {
  blocks: RenderBlock[];
  paragraphs: string[];
};

export type PageJobRecord = {
  id: string;
  orderId: string;
  version: number;
  documentId: string;
  pageId: string;
  pageNumber: number;
  combinedPageNumber: number;
  status: PageJobStatus;
  attempts: number;
  output: PageJobOutput | null;
  error: string | null;
  updatedAt: string;
};

export type TranslationRunRecord = {
  orderId: string;
  version: number;
  status: TranslationRunStatus;
  pageCount: number;
  round: number;
  token: string | null;
  qaIssues: QaIssue[];
  updatedAt: string;
};

export type NumberedPage = PageRecord & { number: number };

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseQaIssues(value: unknown): QaIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is QaIssue => {
    if (!item || typeof item !== "object") return false;
    const row = item as QaIssue;
    return typeof row.type === "string" && typeof row.note === "string";
  });
}

const BLOCK_TYPES = new Set(["heading", "paragraph", "fields", "seal", "signature", "note"]);

export function parsePageJobOutput(value: unknown): PageJobOutput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { blocks?: unknown; paragraphs?: unknown };
  if (!Array.isArray(row.blocks)) return null;
  const blocks = row.blocks.filter((block): block is RenderBlock => {
    if (!block || typeof block !== "object") return false;
    return BLOCK_TYPES.has(String((block as { type?: unknown }).type));
  });
  if (blocks.length === 0) return null;
  const paragraphs = Array.isArray(row.paragraphs)
    ? row.paragraphs.filter((item): item is string => typeof item === "string")
    : blocksToParagraphs(blocks);
  return { blocks, paragraphs: paragraphs.length > 0 ? paragraphs : blocksToParagraphs(blocks) };
}

function mapRun(row: Row): TranslationRunRecord {
  const status = str(row.status);
  return {
    orderId: String(row.order_id),
    version: num(row.version) ?? 1,
    status:
      status === "assembling" || status === "ready" || status === "failed" || status === "running"
        ? status
        : "running",
    pageCount: num(row.page_count) ?? 0,
    round: num(row.round) ?? 0,
    token: str(row.token),
    qaIssues: parseQaIssues(row.qa_issues),
    updatedAt: str(row.updated_at) ?? "",
  };
}

function mapJob(row: Row): PageJobRecord {
  const status = str(row.status);
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    version: num(row.version) ?? 1,
    documentId: String(row.document_id),
    pageId: String(row.page_id),
    pageNumber: num(row.page_number) ?? 1,
    combinedPageNumber: num(row.combined_page_number) ?? 1,
    status:
      status === "running" || status === "ready" || status === "failed" || status === "pending"
        ? status
        : "pending",
    attempts: num(row.attempts) ?? 0,
    output: parsePageJobOutput(row.output),
    error: str(row.error),
    updatedAt: str(row.updated_at) ?? "",
  };
}

export async function findOpenRun(db: Db, orderId: string): Promise<TranslationRunRecord | null> {
  const { data, error } = await db
    .from("translation_runs")
    .select("*")
    .eq("order_id", orderId)
    .in("status", ["running", "assembling"])
    .order("version", { ascending: false })
    .limit(1);
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapRun(row) : null;
}

export async function getTranslationRun(
  db: Db,
  orderId: string,
  version: number,
): Promise<TranslationRunRecord | null> {
  const { data, error } = await db
    .from("translation_runs")
    .select("*")
    .eq("order_id", orderId)
    .eq("version", version)
    .maybeSingle();
  fail(error);
  return data ? mapRun(data as Row) : null;
}

export async function listPageJobs(db: Db, orderId: string, version: number): Promise<PageJobRecord[]> {
  const { data, error } = await db
    .from("translation_page_jobs")
    .select("*")
    .eq("order_id", orderId)
    .eq("version", version)
    .order("combined_page_number", { ascending: true });
  fail(error);
  return ((data ?? []) as Row[]).map(mapJob);
}

async function getJob(db: Db, jobId: string): Promise<PageJobRecord | null> {
  const { data, error } = await db.from("translation_page_jobs").select("*").eq("id", jobId).maybeSingle();
  fail(error);
  return data ? mapJob(data as Row) : null;
}

export async function loadOrderPages(db: Db, orderId: string): Promise<{
  documents: Awaited<ReturnType<typeof listDocuments>>;
  pages: NumberedPage[];
}> {
  const documents = inReadingOrder(await listDocuments(db, orderId));
  const pages = withCombinedNumbers(
    documents,
    await listPages(
      db,
      documents.map((document) => document.id),
    ),
  );
  return { documents, pages };
}

const TRANSLATION_STATUSES = [
  "confirmed",
  "correction_requested",
  "failed",
  "preview_ready",
  "processing",
  "paid",
] as const;

async function claimOrder(
  db: Db,
  order: OrderRecord,
  pagesTranslateTotal: number,
  retryFailure = false,
): Promise<boolean> {
  // A later round must not paint 1/1 back to 0/1. The check clamps a count above the new total.
  const progress = checkedProgress(order.progress, {
    step: "translating",
    pagesDone: order.progress.pagesDone ?? 0,
    pagesTranslateTotal,
  });
  const patch: Record<string, unknown> = { status: "processing", progress };
  if (retryFailure) {
    patch.review_reason = null;
    const { data, error } = await db
      .from("orders")
      .update(patch)
      .eq("id", order.id)
      .eq("status", "failed")
      .select("id");
    fail(error);
    return (data ?? []).length > 0;
  }
  const { data, error } = await db
    .from("orders")
    .update(patch)
    .eq("id", order.id)
    .in("status", [...TRANSLATION_STATUSES])
    .select("id");
  fail(error);
  return (data ?? []).length > 0;
}

/** Drop an open run so in-flight page jobs cannot assemble or fail the order. */
async function supersedeOpenRuns(db: Db, orderId: string): Promise<void> {
  const { error } = await db
    .from("translation_runs")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .in("status", ["running", "assembling"]);
  fail(error);
}

async function insertRun(
  db: Db,
  input: {
    orderId: string;
    version: number;
    pageCount: number;
    round: number;
    token: string | null;
    qaIssues: QaIssue[];
  },
): Promise<"inserted" | "exists"> {
  const { error } = await db.from("translation_runs").insert({
    order_id: input.orderId,
    version: input.version,
    status: "running",
    page_count: input.pageCount,
    round: input.round,
    token: input.token,
    qa_issues: input.qaIssues,
  });
  if (error?.code === "23505") return "exists";
  fail(error);
  return "inserted";
}

async function insertJobs(
  db: Db,
  orderId: string,
  version: number,
  pages: NumberedPage[],
): Promise<void> {
  if (pages.length === 0) return;
  const { error } = await db.from("translation_page_jobs").insert(
    pages.map((page) => ({
      order_id: orderId,
      version,
      document_id: page.documentId,
      page_id: page.id,
      page_number: page.pageNumber,
      combined_page_number: page.number,
      status: "pending",
      attempts: 0,
    })),
  );
  if (error?.code === "23505") return;
  fail(error);
}

export async function bumpTranslationProgress(
  db: Db,
  orderId: string,
  pagesDone: number,
  pagesTranslateTotal: number,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const order = await getOrderById(db, orderId);
    if (!order) return;
    const current = order.progress.pagesDone ?? 0;
    if (pagesDone < current) return;
    const progress = checkedProgress(order.progress, {
      step: "translating",
      pagesDone,
      pagesTranslateTotal,
    });
    const { data, error } = await db
      .from("orders")
      .update({ progress })
      .eq("id", orderId)
      .filter("progress->>pagesDone", "eq", String(current))
      .select("id");
    fail(error);
    if ((data ?? []).length > 0) return;
  }
}

export async function fillTranslationSlots(db: Db, orderId: string, version: number): Promise<void> {
  const run = await getTranslationRun(db, orderId, version);
  if (!run || run.status !== "running") return;
  const jobs = await listPageJobs(db, orderId, version);
  const batch = jobsToDispatch(jobs, TRANSLATION_PAGE_CONCURRENCY);
  await Promise.all(
    batch.map((job) =>
      dispatchTranslation(TRANSLATION_PAGE_PATH, { orderId, version, jobId: job.id }),
    ),
  );
}

async function dispatchAssemble(orderId: string, version: number): Promise<void> {
  await dispatchTranslation(TRANSLATION_ASSEMBLE_PATH, { orderId, version });
}

export async function failTranslationOrder(
  db: Db,
  input: { orderId: string; version: number; error: unknown },
): Promise<void> {
  const order = await getOrderById(db, input.orderId);
  if (!order) return;
  const run = await getTranslationRun(db, input.orderId, input.version);
  if (run?.status === "failed" || run?.status === "ready") return;
  const open = (await listCorrections(db, input.orderId)).filter((correction) => correction.status === "open");
  const decision = decideTranslationFailure({
    error: input.error,
    readyPreview: (await latestReadyPreview(db, input.orderId)) != null,
    openCorrections: open.length > 0,
  });
  await db
    .from("translation_runs")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("order_id", input.orderId)
    .eq("version", input.version)
    .in("status", ["running", "assembling"]);
  await markPreview(db, input.orderId, input.version, "failed");
  await updateOrder(db, input.orderId, {
    status: decision.status,
    review_reason: decision.reviewReason,
    progress: checkedProgress(order.progress, { step: "done" }),
  });
  if (!decision.notifyFailed) return;
  const { notifyOrder } = await import("./webhook-delivery");
  await notifyOrder(db, input.orderId, "order.failed");
}

export async function beginTranslation(
  db: Db,
  order: OrderRecord,
  token: string | null,
  input: { round: number; qaIssues: QaIssue[]; retryFailure?: boolean },
): Promise<void> {
  const { pages } = await loadOrderPages(db, order.id);
  if (pages.length === 0 || !order.combinedOriginalPath) {
    throw new Error("The original pages are not ready to translate.");
  }
  const billable = pagesToTranslate(pages);
  const claimed = await claimOrder(db, order, billable.length, input.retryFailure === true);
  if (!claimed) return;
  if (input.retryFailure) await supersedeOpenRuns(db, order.id);

  const version = await nextPreviewVersion(db, order.id);
  const previewPath = `${order.id}/preview-v${version}.pdf`;
  const runInsert = await insertRun(db, {
    orderId: order.id,
    version,
    pageCount: billable.length,
    round: input.round,
    token,
    qaIssues: input.qaIssues,
  });
  if (runInsert === "exists") {
    const run = await getTranslationRun(db, order.id, version);
    if (run) await resumeTranslation(db, run);
    return;
  }

  await insertJobs(db, order.id, version, billable);
  const preview = await insertPreview(db, { orderId: order.id, version, previewPath });
  if (preview === "exists") {
    await fillTranslationSlots(db, order.id, version);
    return;
  }
  if (billable.length === 0) {
    await dispatchAssemble(order.id, version);
    return;
  }
  await fillTranslationSlots(db, order.id, version);
}

export async function resumeTranslation(db: Db, run: TranslationRunRecord, now = Date.now()): Promise<void> {
  if (run.status === "assembling") {
    await dispatchAssemble(run.orderId, run.version);
    return;
  }
  if (run.status !== "running") return;

  const jobs = await listPageJobs(db, run.orderId, run.version);
  for (const job of jobs) {
    if (job.status !== "running") continue;
    const updated = Date.parse(job.updatedAt);
    const stuck = !Number.isFinite(updated) || now - updated > TRANSLATION_JOB_STUCK_MS;
    if (!stuck) continue;
    const next = job.attempts >= PAGE_ATTEMPT_LIMIT ? "failed" : "pending";
    await db
      .from("translation_page_jobs")
      .update({ status: next, updated_at: new Date(now).toISOString() })
      .eq("id", job.id)
      .eq("status", "running");
  }

  const refreshed = await listPageJobs(db, run.orderId, run.version);
  if (refreshed.some((job) => job.status === "failed")) {
    const failed = refreshed.find((job) => job.status === "failed");
    await failTranslationOrder(db, {
      orderId: run.orderId,
      version: run.version,
      error: new Error(failed?.error || "A page failed twice."),
    });
    return;
  }
  if (refreshed.length < run.pageCount) {
    await fillTranslationSlots(db, run.orderId, run.version);
    return;
  }
  if (refreshed.every((job) => job.status === "ready")) {
    await dispatchAssemble(run.orderId, run.version);
    return;
  }
  await fillTranslationSlots(db, run.orderId, run.version);
}

export async function claimAssemble(db: Db, orderId: string, version: number, now = Date.now()): Promise<boolean> {
  const at = new Date(now).toISOString();
  const { data, error } = await db
    .from("translation_runs")
    .update({ status: "assembling", updated_at: at })
    .eq("order_id", orderId)
    .eq("version", version)
    .eq("status", "running")
    .select("order_id");
  fail(error);
  if ((data ?? []).length > 0) return true;

  // A second after() sees assembling. Only a dead worker, older than the stuck window, may enter.
  const run = await getTranslationRun(db, orderId, version);
  if (run?.status !== "assembling" || !run.updatedAt) return false;
  const updated = Date.parse(run.updatedAt);
  if (!Number.isFinite(updated) || now - updated < TRANSLATION_JOB_STUCK_MS) return false;
  const reclaimed = await db
    .from("translation_runs")
    .update({ updated_at: at })
    .eq("order_id", orderId)
    .eq("version", version)
    .eq("status", "assembling")
    .eq("updated_at", run.updatedAt)
    .select("order_id");
  fail(reclaimed.error);
  return (reclaimed.data ?? []).length > 0;
}

export async function claimPageJob(db: Db, jobId: string): Promise<PageJobRecord | null> {
  const current = await getJob(db, jobId);
  if (!current || current.status !== "pending" || current.attempts >= PAGE_ATTEMPT_LIMIT) return null;
  const run = await getTranslationRun(db, current.orderId, current.version);
  if (!run || run.status !== "running") return null;
  const { data, error } = await db
    .from("translation_page_jobs")
    .update({
      status: "running",
      attempts: current.attempts + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .eq("attempts", current.attempts)
    .select("*");
  fail(error);
  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapJob(row) : null;
}

export type PageWork = {
  job: PageJobRecord;
  run: TranslationRunRecord;
  order: OrderRecord;
  filename: string;
  page: NumberedPage;
  fields: ConfirmationRecord[];
  corrections: CorrectionRecord[];
  qaIssues: QaIssue[];
};

export async function loadPageWork(db: Db, jobId: string): Promise<PageWork | null> {
  const job = await getJob(db, jobId);
  if (!job) return null;
  const [run, order] = await Promise.all([
    getTranslationRun(db, job.orderId, job.version),
    getOrderById(db, job.orderId),
  ]);
  if (!run || !order || !order.sourceLanguage) return null;
  const { documents, pages } = await loadOrderPages(db, job.orderId);
  const page = pages.find((item) => item.id === job.pageId);
  const document = documents.find((item) => item.id === job.documentId);
  if (!page || !document || isSkippedTranslationPage(page)) return null;
  const [fields, corrections] = await Promise.all([
    listConfirmations(db, job.orderId),
    listCorrections(db, job.orderId),
  ]);
  return {
    job,
    run,
    order,
    filename: document.filename,
    page,
    fields: fields.filter((field) => field.documentId === document.id),
    corrections: corrections.filter((correction) => correction.status === "open"),
    qaIssues: run.qaIssues,
  };
}

async function publishReadyPages(db: Db, job: PageJobRecord): Promise<void> {
  const run = await getTranslationRun(db, job.orderId, job.version);
  if (!run || (run.status !== "running" && run.status !== "assembling")) return;
  const jobs = await listPageJobs(db, job.orderId, job.version);
  const pagesDone = jobs.filter((item) => item.status === "ready").length;
  await bumpTranslationProgress(db, job.orderId, pagesDone, jobs.length);
  if (jobs.length > 0 && jobs.every((item) => item.status === "ready")) {
    await dispatchAssemble(job.orderId, job.version);
    return;
  }
  await fillTranslationSlots(db, job.orderId, job.version);
}

/** Stores the page once. A second success does not lower pagesDone or start another assemble claim. */
export async function completePageJob(
  db: Db,
  job: PageJobRecord,
  output: PageJobOutput,
): Promise<void> {
  const current = await getJob(db, job.id);
  if (current?.status === "ready" && current.output) {
    await publishReadyPages(db, current);
    return;
  }
  const saved = await db
    .from("translation_page_jobs")
    .update({
      status: "ready",
      output,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "running")
    .select("id");
  fail(saved.error);
  if ((saved.data ?? []).length === 0) {
    const again = await getJob(db, job.id);
    if (again?.status === "ready") await publishReadyPages(db, again);
    return;
  }
  await publishReadyPages(db, job);
}

export async function failPageJob(db: Db, job: PageJobRecord, error: unknown): Promise<void> {
  const latest = await getJob(db, job.id);
  if (!latest || latest.status === "ready" || latest.status === "failed") return;
  const message = error instanceof Error ? error.message : "Translation failed.";
  const run = await getTranslationRun(db, latest.orderId, latest.version);
  if (!run || run.status !== "running") {
    const closed = await db
      .from("translation_page_jobs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", latest.id)
      .eq("status", "running")
      .select("id");
    fail(closed.error);
    return;
  }
  const result = pageAttemptResult(latest.attempts, false);
  if (result === "retry") {
    const requeued = await db
      .from("translation_page_jobs")
      .update({ status: "pending", error: message, updated_at: new Date().toISOString() })
      .eq("id", latest.id)
      .eq("status", "running")
      .select("id");
    fail(requeued.error);
    if ((requeued.data ?? []).length === 0) return;
    await dispatchTranslation(TRANSLATION_PAGE_PATH, {
      orderId: latest.orderId,
      version: latest.version,
      jobId: latest.id,
    });
    return;
  }

  const failed = await db
    .from("translation_page_jobs")
    .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
    .eq("id", latest.id)
    .eq("status", "running")
    .select("id");
  fail(failed.error);
  if ((failed.data ?? []).length === 0) return;
  await failTranslationOrder(db, { orderId: latest.orderId, version: latest.version, error });
}

export async function markRunReady(db: Db, orderId: string, version: number): Promise<void> {
  const { error } = await db
    .from("translation_runs")
    .update({ status: "ready", updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("version", version);
  fail(error);
}

export async function markRunFailed(db: Db, orderId: string, version: number): Promise<void> {
  const { error } = await db
    .from("translation_runs")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("version", version);
  fail(error);
}
