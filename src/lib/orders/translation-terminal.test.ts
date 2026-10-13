import { describe, expect, it } from "vitest";
import { AiUnavailableError } from "./errors";
import type { Db } from "./storage";
import { failPageJob, failTranslationOrder, type PageJobRecord } from "./translation-jobs";
import { runTranslationPage } from "./translation";
import { TRANSLATION_STALE_MS } from "./translation-watch";
import { runTranslationWatchdog } from "./translation-watchdog";

const NOW = Date.parse("2026-10-12T20:00:00.000Z");
const STALE = new Date(NOW - TRANSLATION_STALE_MS - 60_000).toISOString();

type Row = Record<string, unknown>;

const TERMINAL = ["cancelled", "delivered", "paid", "approved", "preview_ready"] as const;

class MemoryDb {
  tables: Record<string, Row[]> = {};
  /** The next orders update first moves this id to cancelled, then applies its filters. */
  cancelBeforeUpdate: string | null = null;

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new Query(this, table);
  }
}

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private op: "select" | "update" = "select";
  private patch: Row | null = null;
  private mode: "many" | "maybeSingle" = "many";
  private pending: Promise<{ data: unknown; error: { message: string } | null }> | null = null;

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

  lt(column: string, value: unknown) {
    this.filters.push((row) => {
      const current = row[column];
      return current != null && current < (value as string | number);
    });
    return this;
  }

  contains(column: string, value: Record<string, unknown>) {
    this.filters.push((row) => {
      const current = row[column];
      if (!current || typeof current !== "object") return false;
      return Object.entries(value).every(([key, expected]) => (current as Row)[key] === expected);
    });
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
    if (this.table === "orders" && this.db.cancelBeforeUpdate) {
      const id = this.db.cancelBeforeUpdate;
      this.db.cancelBeforeUpdate = null;
      for (const row of this.db.tables.orders ?? []) {
        if (row.id === id) row.status = "cancelled";
      }
    }
    return this;
  }

  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onFulfilled?:
      | ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onFulfilled, onRejected);
  }

  private exec() {
    if (!this.pending) this.pending = Promise.resolve(this.run());
    return this.pending;
  }

  private matching(): Row[] {
    let found = (this.db.tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row)));
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

  private run(): { data: unknown; error: { message: string } | null } {
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
}

function orderId(status: string): string {
  return `${status}-1111-4111-8111-111111111111`;
}

function translatingProgress(retries = 1): Row {
  return {
    step: "translating",
    pagesRead: 1,
    pagesTotal: 1,
    pagesDone: 1,
    pagesTranslateTotal: 1,
    retries,
  };
}

function orderRow(status: string, patch: Row = {}): Row {
  return {
    id: orderId(status),
    customer_id: "cust-1",
    status,
    source_language: "es",
    target_language: "en",
    language_confirmed: true,
    review_reason: null,
    service_type: "translation",
    order_type: "translation",
    service: null,
    progress: translatingProgress(),
    updated_at: STALE,
    staff_alert_sent_at: null,
    ...patch,
  };
}

function seedRun(db: MemoryDb, id: string): void {
  db.tables.translation_runs = [
    ...(db.tables.translation_runs ?? []),
    {
      order_id: id,
      version: 1,
      status: "running",
      page_count: 1,
      round: 0,
      token: null,
      qa_issues: [],
    },
  ];
}

function seedJob(db: MemoryDb, id: string, attempts: number): PageJobRecord {
  const row = {
    id: `job-${id}`,
    order_id: id,
    version: 1,
    document_id: "doc-1",
    page_id: "page-1",
    page_number: 1,
    combined_page_number: 1,
    status: "pending",
    attempts,
    output: null,
    error: null,
    updated_at: STALE,
  };
  db.tables.translation_page_jobs = [...(db.tables.translation_page_jobs ?? []), row];
  return {
    id: row.id,
    orderId: id,
    version: 1,
    documentId: "doc-1",
    pageId: "page-1",
    pageNumber: 1,
    combinedPageNumber: 1,
    status: "running",
    attempts,
    output: null,
    sourceLanguage: null,
    targetLanguage: null,
    error: null,
    updatedAt: STALE,
  };
}

function statusOf(db: MemoryDb, id: string): string {
  const row = db.tables.orders.find((order) => order.id === id);
  return String(row?.status);
}

function asDb(db: MemoryDb): Db {
  return db as unknown as Db;
}

describe("terminal translation orders", () => {
  it("leaves cancelled, delivered, paid, finalized, and preview-ready orders alone", async () => {
    const db = new MemoryDb();
    db.tables.orders = TERMINAL.map((status) => orderRow(status));

    const watch = await runTranslationWatchdog(asDb(db), NOW);

    expect(watch).toEqual({ retried: [], flagged: [] });
    for (const status of TERMINAL) {
      expect(statusOf(db, orderId(status))).toBe(status);
      const row = db.tables.orders.find((order) => order.id === orderId(status));
      expect(row?.review_reason).toBeNull();
    }

    for (const status of TERMINAL) {
      await failTranslationOrder(asDb(db), {
        orderId: orderId(status),
        version: 1,
        error: new AiUnavailableError("translation_timeout"),
      });
      expect(statusOf(db, orderId(status))).toBe(status);
    }
  });

  it("does not flip a cancelled order when the watchdog update loses the race", async () => {
    const db = new MemoryDb();
    const id = "fb37eb19-2222-4222-8222-222222222222";
    db.tables.orders = [orderRow("processing", { id })];
    db.cancelBeforeUpdate = id;

    const watch = await runTranslationWatchdog(asDb(db), NOW);

    expect(watch).toEqual({ retried: [], flagged: [] });
    expect(statusOf(db, id)).toBe("cancelled");
    expect(db.tables.orders[0]?.review_reason).toBeNull();
  });

  it("does not flip a cancelled order when a late page failure runs", async () => {
    const db = new MemoryDb();
    const id = "fb37eb19-3333-4333-8333-333333333333";
    db.tables.orders = [orderRow("cancelled", { id })];
    seedRun(db, id);
    const job = seedJob(db, id, 2);
    job.status = "running";
    const stored = db.tables.translation_page_jobs[0];
    if (stored) stored.status = "running";

    await failPageJob(asDb(db), job, new AiUnavailableError("translation_timeout"));

    expect(statusOf(db, id)).toBe("cancelled");
    expect(db.tables.orders[0]?.review_reason).toBeNull();
    expect(db.tables.translation_page_jobs[0]?.status).toBe("failed");
  });

  it("does not review a cancelled order from a late page invocation", async () => {
    const db = new MemoryDb();
    const id = "fb37eb19-4444-4444-8444-444444444444";
    db.tables.orders = [orderRow("cancelled", { id, source_language: null })];
    seedRun(db, id);
    seedJob(db, id, 1);

    await runTranslationPage(asDb(db), { orderId: id, version: 1, jobId: `job-${id}` });

    expect(statusOf(db, id)).toBe("cancelled");
    expect(db.tables.orders[0]?.review_reason).toBeNull();
    expect(db.tables.orders[0]?.staff_alert_sent_at).toBeNull();
  });

  it("still flags a processing order that is actually stuck", async () => {
    const db = new MemoryDb();
    const id = orderId("processing");
    db.tables.orders = [orderRow("processing")];
    seedRun(db, id);

    const watch = await runTranslationWatchdog(asDb(db), NOW);

    expect(watch.flagged).toEqual([id]);
    expect(statusOf(db, id)).toBe("needs_review");
    expect(db.tables.orders[0]?.review_reason).toBe("translation_timeout");

    db.tables.orders = [orderRow("processing", { id: orderId("confirmed"), status: "processing" })];
    const openId = orderId("confirmed");
    seedRun(db, openId);
    await failTranslationOrder(asDb(db), {
      orderId: openId,
      version: 1,
      error: new AiUnavailableError("translation_timeout"),
    });
    expect(statusOf(db, openId)).toBe("needs_review");
  });
});
