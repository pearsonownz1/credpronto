import type { RenderBlock } from "./pdf/layout";

/** How many page invocations run at once. Each invocation is one billable page. */
export const TRANSLATION_PAGE_CONCURRENCY = 3;

/** First try plus one retry. A third failure is not started. */
export const PAGE_ATTEMPT_LIMIT = 2;

/** A running job older than this was killed with its function. The watchdog is slower. */
export const TRANSLATION_JOB_STUCK_MS = 6 * 60 * 1000;

const SKIPPED_REASONS = new Set([
  "english",
  "already english",
  "blank",
  "label",
  "shipping label",
  "not a document",
]);

export type TranslationPageLike = {
  skip?: boolean;
  skipReason?: string | null;
};

function normalizedReason(reason: string | null | undefined): string {
  return (reason ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** English, blank, and label pages are not sent to the model. A customer skip is not either. */
export function isSkippedTranslationPage(page: TranslationPageLike): boolean {
  if (page.skip === true) return true;
  return SKIPPED_REASONS.has(normalizedReason(page.skipReason));
}

export function pagesToTranslate<T extends TranslationPageLike>(pages: readonly T[]): T[] {
  return pages.filter((page) => !isSkippedTranslationPage(page));
}

export type DispatchJob = {
  id: string;
  status: "pending" | "running" | "ready" | "failed";
};

/**
 * The outer fan-out uses the full cap. A worker that is already translating
 * starts at most one more page, and never past the cap.
 */
export function dispatchConcurrency(running: number, nested: boolean): number {
  if (!nested) return TRANSLATION_PAGE_CONCURRENCY;
  return Math.min(TRANSLATION_PAGE_CONCURRENCY, running + 1);
}

/** Pending jobs that fit in the open slots. */
export function jobsToDispatch<T extends DispatchJob>(jobs: readonly T[], concurrency: number): T[] {
  const running = jobs.filter((job) => job.status === "running").length;
  const slots = Math.max(0, concurrency - running);
  return jobs.filter((job) => job.status === "pending").slice(0, slots);
}

/** `ready` stores the page. `retry` queues the one allowed retry. `fail` stops the order. */
export function pageAttemptResult(attempts: number, ok: boolean): "ready" | "retry" | "fail" {
  if (ok) return "ready";
  return attempts < PAGE_ATTEMPT_LIMIT ? "retry" : "fail";
}

export function passThroughBlocks(text: string | null | undefined): RenderBlock[] {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return [{ type: "paragraph", text: " " }];
  return [{ type: "paragraph", text: trimmed }];
}

export type SimPage = {
  id: string;
  skip?: boolean;
  skipReason?: string | null;
};

export type SimJob = {
  id: string;
  status: DispatchJob["status"];
  attempts: number;
};

export type SimSnapshot = {
  step: "translating" | "done";
  pagesRead: number;
  pagesTotal: number;
  pagesDone: number;
  pagesTranslateTotal: number;
};

export type SimulatedTranslation = {
  invocations: Array<{ pageId: string; attempt: number }>;
  assembled: boolean;
  failure: { pageId: string; attempts: number } | null;
  maxInFlight: number;
  progress: SimSnapshot[];
  pagesTranslateTotal: number;
};

/**
 * In-memory model of the page pool: one invocation per billable page, a concurrency cap,
 * one retry, then a single assemble. Skipped pages never start.
 */
export function simulateBillableTranslation(input: {
  pages: readonly SimPage[];
  ocr: { pagesRead: number; pagesTotal: number };
  concurrency?: number;
  outcomes?: Record<string, Array<"ok" | "fail">>;
}): SimulatedTranslation {
  const concurrency = input.concurrency ?? TRANSLATION_PAGE_CONCURRENCY;
  const billable = pagesToTranslate(input.pages);
  const jobs: SimJob[] = billable.map((page) => ({ id: page.id, status: "pending", attempts: 0 }));
  const outcomes = new Map<string, Array<"ok" | "fail">>(
    Object.entries(input.outcomes ?? {}).map(([id, values]) => [id, [...values]]),
  );
  const invocations: SimulatedTranslation["invocations"] = [];
  const progress: SimSnapshot[] = [];
  let maxInFlight = 0;
  let failure: SimulatedTranslation["failure"] = null;

  const snapshot = (step: SimSnapshot["step"]): SimSnapshot => ({
    step,
    pagesRead: input.ocr.pagesRead,
    pagesTotal: input.ocr.pagesTotal,
    pagesDone: jobs.filter((job) => job.status === "ready").length,
    pagesTranslateTotal: jobs.length,
  });

  progress.push(snapshot("translating"));

  const startSlots = () => {
    for (const job of jobsToDispatch(jobs, concurrency)) {
      job.status = "running";
      job.attempts += 1;
      invocations.push({ pageId: job.id, attempt: job.attempts });
    }
    maxInFlight = Math.max(maxInFlight, jobs.filter((job) => job.status === "running").length);
  };

  startSlots();

  while (jobs.some((job) => job.status === "running") && !failure) {
    const job = jobs.find((item) => item.status === "running");
    if (!job) break;
    const queue = outcomes.get(job.id);
    const outcome = queue && queue.length > 0 ? queue.shift() : "ok";
    const result = pageAttemptResult(job.attempts, outcome !== "fail");
    if (result === "ready") {
      job.status = "ready";
      progress.push(snapshot("translating"));
      startSlots();
      continue;
    }
    if (result === "retry") {
      job.status = "pending";
      startSlots();
      continue;
    }
    job.status = "failed";
    failure = { pageId: job.id, attempts: job.attempts };
    progress.push({ ...snapshot("done"), pagesDone: jobs.filter((item) => item.status === "ready").length });
  }

  const assembled = !failure && jobs.length > 0 && jobs.every((job) => job.status === "ready");
  if (assembled) progress.push(snapshot("done"));
  if (!failure && jobs.length === 0) {
    progress.push(snapshot("done"));
  }

  return {
    invocations,
    assembled,
    failure,
    maxInFlight,
    progress,
    pagesTranslateTotal: jobs.length,
  };
}
