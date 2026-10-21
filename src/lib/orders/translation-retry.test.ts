import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pdf from "./pdf/render";
import * as storage from "./storage";
import type { Db } from "./storage";
import {
  claimPageJob,
  completePageJob,
  failPageJob,
  failTranslationOrder,
  listPageJobs,
  queueEarlyTranslation,
} from "./translation-jobs";
import { TRANSLATION_ASSEMBLE_PATH, TRANSLATION_PAGE_PATH } from "./translation-dispatch";
import * as dispatch from "./translation-dispatch";
import { QA_REVIEW_REASON } from "./qa";
import * as email from "./email";
import { runTranslationAssemble, translateOrder } from "./translation";

const orderId = "28492f38-3333-4333-8333-333333333333";
const dispatchFailure = "Translation dispatch failed (401): unauthorized";

type Row = Record<string, unknown>;

const UNIQUE: Record<string, string[][]> = {
  translation_runs: [["order_id", "version"]],
  translation_page_jobs: [["order_id", "version", "page_id"]],
  previews: [["order_id", "version"]],
};

class MemoryDb {
  tables: Record<string, Row[]> = {};
  /** The next orders update first moves this id to cancelled, then applies its filters. */
  cancelBeforeOrderUpdate: string | null = null;

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new Query(this, table);
  }
}

class Query implements PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private op: "select" | "update" | "insert" | "upsert" = "select";
  private patch: Row | null = null;
  private incoming: Row[] = [];
  private conflict: string[] = [];
  private mode: "many" | "maybeSingle" = "many";
  private pending: Promise<{ data: unknown; error: { message: string; code?: string } | null }> | null = null;

  constructor(
    private db: MemoryDb,
    private table: string,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push((row) => {
      const current = row[column];
      if (current == null || value == null) return false;
      return current <= (value as string | number);
    });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  filter(column: string, operator: string, value: unknown) {
    if (operator !== "eq") throw new Error(`unsupported filter ${operator}`);
    this.filters.push((row) => jsonPath(row, column) === value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.sort = { column, ascending: options?.ascending !== false };
    return this;
  }

  limit(count: number) {
    this.max = count;
    return this;
  }

  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    if (this.table === "orders" && this.db.cancelBeforeOrderUpdate) {
      const id = this.db.cancelBeforeOrderUpdate;
      this.db.cancelBeforeOrderUpdate = null;
      for (const row of this.db.tables.orders ?? []) {
        if (row.id === id) row.status = "cancelled";
      }
    }
    return this;
  }

  insert(values: Row | Row[]) {
    this.op = "insert";
    this.incoming = (Array.isArray(values) ? values : [values]).map((row) => ({ ...row }));
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }) {
    this.op = "upsert";
    this.incoming = (Array.isArray(values) ? values : [values]).map((row) => ({ ...row }));
    this.conflict = options?.onConflict?.split(",").map((column) => column.trim()) ?? [];
    return this;
  }

  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<TResult1 = { data: unknown; error: { message: string; code?: string } | null }, TResult2 = never>(
    onFulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onFulfilled, onRejected);
  }

  private exec() {
    if (!this.pending) this.pending = Promise.resolve(this.run());
    return this.pending;
  }

  private stored(): Row[] {
    return this.db.tables[this.table] ?? [];
  }

  private matching(): Row[] {
    let found = this.stored().filter((row) => this.filters.every((keep) => keep(row)));
    if (this.sort) {
      const { column, ascending } = this.sort;
      found = [...found].sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === right) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return (left < right ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.max != null) found = found.slice(0, this.max);
    return found;
  }

  private run(): { data: unknown; error: { message: string; code?: string } | null } {
    if (this.op === "insert") return this.insertRows();
    if (this.op === "upsert") return this.upsertRows();
    const found = this.matching();
    if (this.op === "update" && this.patch) {
      for (const row of found) Object.assign(row, this.patch);
    }
    if (this.mode === "maybeSingle") {
      if (found.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: found[0] ?? null, error: null };
    }
    return { data: found, error: null };
  }

  private insertRows(): { data: unknown; error: { message: string; code?: string } | null } {
    const table = this.stored();
    const keys = UNIQUE[this.table] ?? [];
    for (const row of this.incoming) {
      const duplicate = keys.some((columns) =>
        table.some((existing) => columns.every((column) => existing[column] === row[column])),
      );
      if (duplicate) return { data: null, error: { message: "duplicate key", code: "23505" } };
    }
    const inserted = this.incoming.map((row) => withIds(this.table, row));
    table.push(...inserted);
    return { data: inserted, error: null };
  }

  private upsertRows(): { data: unknown; error: { message: string; code?: string } | null } {
    const table = this.stored();
    for (const row of this.incoming) {
      const current = table.find((existing) =>
        this.conflict.every((column) => existing[column] === row[column]),
      );
      if (current) Object.assign(current, row);
      else table.push(withIds(this.table, row));
    }
    return { data: null, error: null };
  }
}

function jsonPath(row: Row, column: string): unknown {
  const match = /^(\w+)->>(\w+)$/.exec(column);
  if (!match) return row[column];
  const parent = row[match[1]];
  if (!parent || typeof parent !== "object") return undefined;
  const value = (parent as Row)[match[2]];
  return value == null ? undefined : String(value);
}

function withIds(table: string, row: Row): Row {
  const copy = { ...row };
  if (copy.id == null && table !== "translation_runs") copy.id = crypto.randomUUID();
  const now = new Date().toISOString();
  if (copy.created_at == null) copy.created_at = now;
  if (copy.updated_at == null) copy.updated_at = now;
  return copy;
}

function orderRow(patch: Row = {}): Row {
  return {
    id: orderId,
    customer_id: "cust-1",
    status: "failed",
    source_language: "es",
    target_language: "en",
    language_confirmed: true,
    review_reason: dispatchFailure,
    combined_original_path: `${orderId}/original.pdf`,
    service_type: "translation",
    order_type: "translation",
    billable_pages: 2,
    unit_price_cents: 995,
    total_cents: 1990,
    currency: "usd",
    progress: { step: "done", pagesRead: 2, pagesTotal: 2, pagesDone: 0, pagesTranslateTotal: 2 },
    ...patch,
  };
}

function seedTranslation(db: MemoryDb, status: string, reviewReason: string | null): void {
  db.tables.orders = [orderRow({ status, review_reason: reviewReason })];
  db.tables.documents = [
    {
      id: "doc-1",
      order_id: orderId,
      original_path: `${orderId}/acta.pdf`,
      filename: "acta.pdf",
      mime: "application/pdf",
      size: 10,
      page_count: 2,
      status: "ready",
      position: 0,
    },
  ];
  db.tables.document_pages = [1, 2].map((pageNumber) => ({
    id: `page-${pageNumber}`,
    document_id: "doc-1",
    page_number: pageNumber,
    ocr_text: "Hello",
    word_count: 1,
    billable_units: 1,
    billing_basis: "words",
  }));
  db.tables.translation_runs = [
    {
      order_id: orderId,
      version: 1,
      status: "running",
      page_count: 2,
      round: 0,
      token: "token-1",
      qa_issues: [],
    },
  ];
  db.tables.translation_page_jobs = [1, 2].map((pageNumber) => ({
    id: `job-v1-${pageNumber}`,
    order_id: orderId,
    version: 1,
    document_id: "doc-1",
    page_id: `page-${pageNumber}`,
    page_number: pageNumber,
    combined_page_number: pageNumber,
    status: "running",
    attempts: 1,
    output: null,
    error: null,
  }));
  db.tables.previews = [
    {
      id: "preview-1",
      order_id: orderId,
      version: 1,
      preview_path: `${orderId}/preview-v1.pdf`,
      status: "pending",
    },
  ];
}

function seedOnePage(
  db: MemoryDb,
  options: {
    pagesDone?: number;
    ocrText?: string;
    jobStatus?: string;
    runStatus?: string;
    includeRun?: boolean;
    updatedAt?: string;
  } = {},
): void {
  const pagesDone = options.pagesDone ?? 1;
  const jobStatus = options.jobStatus ?? "ready";
  db.tables.orders = [
    orderRow({
      status: "processing",
      review_reason: null,
      billable_pages: 1,
      total_cents: 995,
      staff_alert_sent_at: null,
      progress: {
        step: "translating",
        pagesRead: 1,
        pagesTotal: 1,
        pagesDone,
        pagesTranslateTotal: 1,
      },
    }),
  ];
  db.tables.documents = [
    {
      id: "doc-1",
      order_id: orderId,
      original_path: `${orderId}/acta.pdf`,
      filename: "acta.pdf",
      mime: "application/pdf",
      size: 10,
      page_count: 1,
      status: "ready",
      position: 0,
    },
  ];
  db.tables.document_pages = [
    {
      id: "page-1",
      document_id: "doc-1",
      page_number: 1,
      ocr_text: options.ocrText ?? "Hello",
      word_count: 1,
      billable_units: 1,
      billing_basis: "words",
    },
  ];
  if (options.includeRun === false) return;
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  db.tables.translation_runs = [
    {
      order_id: orderId,
      version: 1,
      status: options.runStatus ?? "running",
      page_count: 1,
      round: 0,
      token: "token-1",
      qa_issues: [],
      updated_at: updatedAt,
    },
  ];
  db.tables.translation_page_jobs = [
    {
      id: "job-v1-1",
      order_id: orderId,
      version: 1,
      document_id: "doc-1",
      page_id: "page-1",
      page_number: 1,
      combined_page_number: 1,
      status: jobStatus,
      attempts: 1,
      output: jobStatus === "ready" ? pageOutput : null,
      error: null,
      updated_at: updatedAt,
    },
  ];
  db.tables.previews = [
    {
      id: "preview-1",
      order_id: orderId,
      version: 1,
      preview_path: `${orderId}/preview-v1.pdf`,
      status: "pending",
    },
  ];
}

function pageDispatches(): unknown[][] {
  return vi
    .mocked(dispatch.dispatchTranslation)
    .mock.calls.filter((call) => call[0] === TRANSLATION_PAGE_PATH);
}

function orderStatus(db: MemoryDb): { status: unknown; reviewReason: unknown; progress: Row } {
  const row = db.tables.orders[0];
  return {
    status: row?.status,
    reviewReason: row?.review_reason,
    progress: (row?.progress ?? {}) as Row,
  };
}

const pageOutput = {
  blocks: [{ type: "paragraph" as const, text: "Hello" }],
  paragraphs: ["Hello"],
};

describe("retry a translation that failed to dispatch", () => {
  let db: MemoryDb;

  beforeEach(() => {
    db = new MemoryDb();
    vi.restoreAllMocks();
    vi.spyOn(dispatch, "dispatchTranslation").mockResolvedValue(undefined);
    vi.spyOn(pdf, "renderOrderPdfs").mockResolvedValue({
      cleanTranslation: new Uint8Array([1]),
      watermarkedPreview: new Uint8Array([2]),
      certification: new Uint8Array([3]),
    });
    vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
  });

  it("resets the order, starts a new version, ignores stale jobs, and lets assembly mark the preview ready", async () => {
    seedTranslation(db, "failed", dispatchFailure);
    const handle = db as unknown as Db;

    await translateOrder(handle, orderId, "token-1");

    expect(orderStatus(db)).toMatchObject({
      status: "processing",
      reviewReason: null,
      progress: { step: "translating", pagesDone: 0, pagesTranslateTotal: 2 },
    });
    expect(db.tables.translation_runs.map((run) => [run.version, run.status])).toEqual([
      [1, "failed"],
      [2, "running"],
    ]);
    const pageCalls = vi.mocked(dispatch.dispatchTranslation).mock.calls.map((call) => call[1]);
    expect(pageCalls.every((body) => body.version === 2)).toBe(true);

    const stale = await listPageJobs(handle, orderId, 1);
    await completePageJob(handle, stale[0], pageOutput);
    await failPageJob(handle, stale[1], new Error("stale page"));

    expect(orderStatus(db).status).toBe("processing");
    expect(orderStatus(db).progress.pagesDone).toBe(0);
    expect(vi.mocked(dispatch.dispatchTranslation).mock.calls.some((call) => call[0] === TRANSLATION_ASSEMBLE_PATH)).toBe(
      false,
    );
    expect(vi.mocked(dispatch.dispatchTranslation).mock.calls.some((call) => call[1].version === 1)).toBe(false);

    const fresh = await listPageJobs(handle, orderId, 2);
    expect(fresh).toHaveLength(2);
    for (const job of fresh) {
      const claimed = await claimPageJob(handle, job.id);
      expect(claimed?.version).toBe(2);
      await completePageJob(handle, claimed!, pageOutput);
    }

    expect(orderStatus(db).progress).toMatchObject({ pagesDone: 2, pagesTranslateTotal: 2 });
    expect(vi.mocked(dispatch.dispatchTranslation).mock.calls).toContainEqual([
      TRANSLATION_ASSEMBLE_PATH,
      { orderId, version: 2 },
    ]);

    await runTranslationAssemble(handle, { orderId, version: 2 });

    expect(orderStatus(db).status).toBe("preview_ready");
    expect(orderStatus(db).reviewReason).toBeNull();
    expect(db.tables.translation_runs.find((run) => run.version === 2)?.status).toBe("ready");
    expect(db.tables.previews.find((preview) => preview.version === 2)?.status).toBe("ready");

    await failPageJob(handle, stale[0], new Error("late stale failure"));
    expect(orderStatus(db).status).toBe("preview_ready");
  });

  it("does not restart a paid order or a released order", async () => {
    seedTranslation(db, "paid", dispatchFailure);
    const handle = db as unknown as Db;
    await translateOrder(handle, orderId, "token-1");
    expect(orderStatus(db).status).toBe("paid");
    expect(orderStatus(db).reviewReason).toBe(dispatchFailure);
    expect(db.tables.translation_runs.map((run) => run.version)).toEqual([1]);
    expect(
      vi.mocked(dispatch.dispatchTranslation).mock.calls.every(
        (call) => call[0] === TRANSLATION_PAGE_PATH && call[1].version === 1,
      ),
    ).toBe(true);

    db.tables.orders[0].status = "approved";
    db.tables.orders[0].final_translation_path = `${orderId}/translation-v1.pdf`;
    vi.mocked(dispatch.dispatchTranslation).mockClear();
    await translateOrder(handle, orderId, "token-1");
    expect(orderStatus(db).status).toBe("approved");
    expect(dispatch.dispatchTranslation).not.toHaveBeenCalled();

    db.tables.orders[0].status = "delivered";
    await translateOrder(handle, orderId, "token-1");
    expect(orderStatus(db).status).toBe("delivered");
    expect(dispatch.dispatchTranslation).not.toHaveBeenCalled();
  });

  it("leaves a non-translation failure on its current run", async () => {
    seedTranslation(db, "failed", "image_quality");
    const handle = db as unknown as Db;
    await translateOrder(handle, orderId, "token-1");
    expect(orderStatus(db)).toMatchObject({ status: "failed", reviewReason: "image_quality" });
    expect(db.tables.translation_runs).toHaveLength(1);
    expect(db.tables.translation_runs[0]?.status).toBe("running");
  });

  it("flags a processing order when QA retranslation is exhausted", async () => {
    exhaustQa(db, "processing");
    db.tables.orders[0].staff_alert_sent_at = null;
    const previousAlerts = process.env.STAFF_ALERT_EMAILS;
    process.env.STAFF_ALERT_EMAILS = "staff@example.com";
    vi.spyOn(email, "sendTranslationFailureAlert").mockResolvedValue({ sent: true, skipped: false });
    try {
      await runTranslationAssemble(db as unknown as Db, { orderId, version: 1 });
    } finally {
      if (previousAlerts == null) delete process.env.STAFF_ALERT_EMAILS;
      else process.env.STAFF_ALERT_EMAILS = previousAlerts;
    }
    expect(orderStatus(db)).toMatchObject({
      status: "needs_review",
      reviewReason: QA_REVIEW_REASON,
    });
    expect(email.sendTranslationFailureAlert).toHaveBeenCalledTimes(1);
    expect(typeof db.tables.orders[0]?.staff_alert_sent_at).toBe("string");
  });

  it("does not overwrite a cancelled order when QA retranslation is exhausted", async () => {
    for (const status of ["cancelled", "delivered", "paid", "approved", "preview_ready"]) {
      db = new MemoryDb();
      exhaustQa(db, status);
      await runTranslationAssemble(db as unknown as Db, { orderId, version: 1 });
      expect(orderStatus(db).status).toBe(status);
      expect(orderStatus(db).reviewReason).toBeNull();
    }

    db = new MemoryDb();
    exhaustQa(db, "processing");
    db.cancelBeforeOrderUpdate = orderId;
    await runTranslationAssemble(db as unknown as Db, { orderId, version: 1 });
    expect(orderStatus(db).status).toBe("cancelled");
    expect(orderStatus(db).reviewReason).toBeNull();
  });

  it("keeps pagesDone when the same page is stored twice and a late failure arrives", async () => {
    seedOnePage(db, { pagesDone: 0, jobStatus: "running" });
    const handle = db as unknown as Db;
    const [job] = await listPageJobs(handle, orderId, 1);

    await completePageJob(handle, job, pageOutput);
    expect(orderStatus(db).progress).toMatchObject({ pagesDone: 1, pagesTranslateTotal: 1 });

    const pagesBefore = pageDispatches().length;
    await completePageJob(handle, job, pageOutput);
    await failPageJob(handle, job, new Error("late failure after success"));

    expect(orderStatus(db).status).toBe("processing");
    expect(orderStatus(db).progress).toMatchObject({ pagesDone: 1, pagesTranslateTotal: 1 });
    expect(pageDispatches()).toHaveLength(pagesBefore);
    expect(db.tables.translation_page_jobs[0]?.status).toBe("ready");
  });

  it("does not paint 1/1 back to 0/1 when assemble starts another round", async () => {
    seedOnePage(db, { pagesDone: 0, jobStatus: "running", ocrText: "Folio 0007" });
    const handle = db as unknown as Db;
    const [job] = await listPageJobs(handle, orderId, 1);

    await completePageJob(handle, job, pageOutput);
    expect(orderStatus(db).progress.pagesDone).toBe(1);

    await runTranslationAssemble(handle, { orderId, version: 1 });

    expect(orderStatus(db)).toMatchObject({
      status: "processing",
      reviewReason: null,
      progress: { step: "translating", pagesDone: 1, pagesTranslateTotal: 1 },
    });
    expect(db.tables.translation_runs.map((run) => [run.version, run.status])).toEqual([
      [1, "failed"],
      [2, "running"],
    ]);
    expect(pageDispatches().some((call) => (call[1] as { version?: number }).version === 2)).toBe(true);

    await failPageJob(handle, job, new Error("stale success raced a retry"));
    expect(orderStatus(db).progress.pagesDone).toBe(1);
    expect(orderStatus(db).status).toBe("processing");
  });

  it("does not run a second assemble or lower pagesDone while the first claim is fresh", async () => {
    seedOnePage(db, {
      pagesDone: 1,
      jobStatus: "ready",
      runStatus: "assembling",
      updatedAt: new Date().toISOString(),
    });
    const handle = db as unknown as Db;

    await runTranslationAssemble(handle, { orderId, version: 1 });

    expect(pdf.renderOrderPdfs).not.toHaveBeenCalled();
    expect(orderStatus(db).status).toBe("processing");
    expect(orderStatus(db).progress).toMatchObject({ pagesDone: 1, pagesTranslateTotal: 1 });
    expect(db.tables.translation_runs[0]?.status).toBe("assembling");
  });

  it("flags needs_review and alerts staff when assemble throws, without lowering pagesDone", async () => {
    seedOnePage(db, { pagesDone: 1, jobStatus: "ready" });
    const previousAlerts = process.env.STAFF_ALERT_EMAILS;
    process.env.STAFF_ALERT_EMAILS = "staff@example.com";
    vi.mocked(pdf.renderOrderPdfs).mockRejectedValue(new Error("preview render failed"));
    vi.spyOn(email, "sendStaffOrderAlert").mockResolvedValue({ sent: true, skipped: false });
    vi.spyOn(email, "sendTranslationFailureAlert").mockResolvedValue({ sent: true, skipped: false });
    const handle = db as unknown as Db;

    try {
      await runTranslationAssemble(handle, { orderId, version: 1 });
    } finally {
      if (previousAlerts == null) delete process.env.STAFF_ALERT_EMAILS;
      else process.env.STAFF_ALERT_EMAILS = previousAlerts;
    }

    expect(orderStatus(db)).toMatchObject({
      status: "needs_review",
      reviewReason: "preview render failed",
    });
    expect(orderStatus(db).progress.pagesDone).toBe(1);
    expect(email.sendStaffOrderAlert).not.toHaveBeenCalled();
    expect(email.sendTranslationFailureAlert).toHaveBeenCalledTimes(1);
    expect(typeof db.tables.orders[0]?.staff_alert_sent_at).toBe("string");
  });

  it("does not zero pagesDone when translation starts again with no open run", async () => {
    seedOnePage(db, { pagesDone: 1, includeRun: false });
    const handle = db as unknown as Db;

    await translateOrder(handle, orderId, "token-1");

    expect(orderStatus(db)).toMatchObject({
      status: "processing",
      progress: { step: "translating", pagesDone: 1, pagesTranslateTotal: 1 },
    });
    expect(db.tables.translation_runs).toHaveLength(1);
    expect(pageDispatches().length).toBeGreaterThan(0);
  });

  it("translates quoted pages before confirm and reruns only a changed page", async () => {
    db.tables.orders = [
      orderRow({
        status: "quoted",
        language_confirmed: false,
        review_reason: null,
        progress: { step: "done", pagesRead: 2, pagesTotal: 2 },
      }),
    ];
    db.tables.documents = [
      {
        id: "doc-1",
        order_id: orderId,
        original_path: `${orderId}/acta.pdf`,
        filename: "acta.pdf",
        mime: "application/pdf",
        size: 10,
        page_count: 2,
        status: "ready",
        position: 0,
      },
    ];
    db.tables.document_pages = [1, 2].map((pageNumber) => ({
      id: `page-${pageNumber}`,
      document_id: "doc-1",
      page_number: pageNumber,
      ocr_text: "Hello",
      word_count: 1,
      billable_units: 1,
      billing_basis: "words",
    }));
    const handle = db as unknown as Db;

    await queueEarlyTranslation(handle, orderId, "token-1");
    await queueEarlyTranslation(handle, orderId, "token-1");

    expect(orderStatus(db)).toMatchObject({ status: "quoted", progress: { step: "done" } });
    expect(db.tables.translation_runs).toHaveLength(1);
    expect(db.tables.translation_page_jobs).toHaveLength(2);
    expect(db.tables.translation_page_jobs.map((job) => job.page_id).sort()).toEqual(["page-1", "page-2"]);
    const firstDispatches = vi.mocked(dispatch.dispatchTranslation).mock.calls.filter((call) => call[0] === TRANSLATION_PAGE_PATH);
    expect(new Set(firstDispatches.map((call) => (call[1] as { jobId: string }).jobId)).size).toBe(2);
    expect(vi.mocked(dispatch.dispatchTranslation).mock.calls.some((call) => call[0] === TRANSLATION_ASSEMBLE_PATH)).toBe(
      false,
    );

    const queued = await listPageJobs(handle, orderId, 1);
    for (const job of queued) {
      const claimed = await claimPageJob(handle, job.id);
      expect(claimed).not.toBeNull();
      await completePageJob(handle, claimed!, pageOutput);
    }
    expect(orderStatus(db)).toMatchObject({ status: "quoted", progress: { step: "done" } });
    expect(orderStatus(db).progress.pagesDone).toBeUndefined();
    expect(vi.mocked(dispatch.dispatchTranslation).mock.calls.some((call) => call[0] === TRANSLATION_ASSEMBLE_PATH)).toBe(
      false,
    );

    await failTranslationOrder(handle, { orderId, version: 1, error: new Error("early page failed") });
    expect(orderStatus(db).status).toBe("quoted");
    expect(db.tables.translation_runs[0]?.status).toBe("running");

    db.tables.orders[0].status = "confirmed";
    db.tables.orders[0].language_confirmed = true;
    db.tables.orders[0].target_language = "es";
    db.tables.document_pages[1].skipped = true;
    vi.mocked(dispatch.dispatchTranslation).mockClear();

    await translateOrder(handle, orderId, "token-1");

    expect(orderStatus(db).status).toBe("confirmed");
    expect(db.tables.translation_runs.map((run) => run.version)).toEqual([1]);
    const pageOne = db.tables.translation_page_jobs.find((job) => job.page_id === "page-1");
    const pageTwo = db.tables.translation_page_jobs.find((job) => job.page_id === "page-2");
    expect(pageOne).toMatchObject({ status: "pending", attempts: 0 });
    expect((pageOne?.output as { targetLanguage?: string }).targetLanguage).toBe("es");
    expect(pageTwo?.status).toBe("ready");
    const rerun = vi.mocked(dispatch.dispatchTranslation).mock.calls;
    expect(rerun.map((call) => call[0])).toEqual([TRANSLATION_PAGE_PATH]);
    expect((rerun[0]?.[1] as { jobId?: string }).jobId).toBe(pageOne?.id);
    expect(rerun.some((call) => call[0] === TRANSLATION_ASSEMBLE_PATH)).toBe(false);
  });

  it("does not start an early translation for an evaluation", async () => {
    db.tables.orders = [
      orderRow({
        status: "quoted",
        language_confirmed: false,
        service: "diploma",
        order_type: "evaluation",
        service_type: "evaluation",
      }),
    ];
    await queueEarlyTranslation(db as unknown as Db, orderId, "token-1");
    expect(db.tables.translation_runs ?? []).toHaveLength(0);
    expect(dispatch.dispatchTranslation).not.toHaveBeenCalled();
  });

  it("does not assemble a cancelled order when a late page finishes", async () => {
    seedOnePage(db, { pagesDone: 1, jobStatus: "running" });
    db.tables.orders[0].status = "cancelled";
    const handle = db as unknown as Db;
    const [job] = await listPageJobs(handle, orderId, 1);
    await completePageJob(handle, job, pageOutput);
    expect(orderStatus(db).status).toBe("cancelled");
    expect(vi.mocked(dispatch.dispatchTranslation).mock.calls.some((call) => call[0] === TRANSLATION_ASSEMBLE_PATH)).toBe(
      false,
    );
  });
});

function exhaustQa(database: MemoryDb, status: string): void {
  seedTranslation(database, status, null);
  const run = database.tables.translation_runs[0];
  // Assemble claims a running row. A fresh assembling row belongs to another worker.
  run.status = "running";
  run.round = 2;
  for (const job of database.tables.translation_page_jobs) {
    job.status = "ready";
    job.output = pageOutput;
  }
  for (const page of database.tables.document_pages) {
    page.ocr_text = "Acta 1990";
  }
}
