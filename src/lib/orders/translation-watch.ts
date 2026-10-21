import { TRANSLATION_TIMEOUT_REASON } from "./translation-failure";

/** A translation with no preview is stale once `updated_at` is older than this. */
export const TRANSLATION_STALE_MS = 4 * 60 * 1000;

/** Statuses that are still waiting on the first preview. */
const PRE_PREVIEW = new Set(["confirmed", "processing"]);

/**
 * Statuses the watchdog leaves alone. `needs_review` is the flagged state.
 * A finished preview, a quote the customer has not confirmed, and closed orders
 * are not translation jobs.
 */
const CLOSED = new Set([
  "draft",
  "quoted",
  "needs_review",
  "preview_ready",
  "paid",
  "approved",
  "delivered",
  "cancelled",
]);

/**
 * Statuses a translation worker may still change.
 * `processing` is the in-flight job. Confirmed and correction orders are still open.
 * Cancelled, paid, delivered, and preview-ready rows are not in this list.
 */
export const OPEN_TRANSLATION_STATUSES = ["confirmed", "processing", "correction_requested"] as const;

/** Customer is waiting on a preview that has not been saved yet. */
const WAITING_FOR_PREVIEW = new Set(["confirmed", "processing", "correction_requested"]);

const PROGRESS_STEPS = new Set([
  "uploaded",
  "reading",
  "language",
  "counting",
  "quoting",
  "done",
  "translating",
]);

export type WatchAction = "retry" | "flag" | "ignore";

export type WatchOrder = {
  id: string;
  status: string;
  progress: unknown;
  updatedAt: string;
  reviewReason: string | null;
  service: string | null;
  orderType: string;
  includeTranslation?: boolean;
};

export type CheckedProgress = {
  step: "uploaded" | "reading" | "language" | "counting" | "quoting" | "done" | "translating";
  pagesRead: number;
  pagesTotal: number;
  retries?: number;
  pagesDone?: number;
  pagesTranslateTotal?: number;
};

export function progressStep(progress: unknown): string | null {
  if (!progress || typeof progress !== "object") return null;
  const step = (progress as { step?: unknown }).step;
  return typeof step === "string" ? step : null;
}

/** Integer retries stored on `orders.progress`. Missing or invalid counts as zero. */
export function progressRetries(progress: unknown): number {
  if (!progress || typeof progress !== "object") return 0;
  const retries = (progress as { retries?: unknown }).retries;
  if (typeof retries !== "number" || !Number.isInteger(retries) || retries < 0) return 0;
  return retries;
}

function nonNegativeInt(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return 0;
}

function optionalCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * Full `orders.progress` object. Keeps page counts inside `orders_progress_chk`
 * and stores `retries` only when it is a positive integer.
 */
export function checkedProgress(
  progress: unknown,
  patch: {
    step: CheckedProgress["step"];
    retries?: number;
    pagesDone?: number;
    pagesTranslateTotal?: number;
  },
): CheckedProgress {
  const row = progress && typeof progress === "object" ? (progress as Record<string, unknown>) : {};
  const pagesTotal = nonNegativeInt(row.pagesTotal);
  const pagesRead = Math.min(nonNegativeInt(row.pagesRead), pagesTotal);
  const retries = patch.retries ?? progressRetries(progress);
  const step = PROGRESS_STEPS.has(patch.step) ? patch.step : "done";
  const pagesTranslateTotal = patch.pagesTranslateTotal ?? optionalCount(row.pagesTranslateTotal);
  let pagesDone = patch.pagesDone ?? optionalCount(row.pagesDone);
  if (pagesDone != null && pagesTranslateTotal != null && pagesDone > pagesTranslateTotal) {
    pagesDone = pagesTranslateTotal;
  }
  return {
    step,
    pagesRead,
    pagesTotal,
    ...(Number.isInteger(retries) && retries > 0 ? { retries } : {}),
    ...(pagesDone != null ? { pagesDone } : {}),
    ...(pagesTranslateTotal != null ? { pagesTranslateTotal } : {}),
  };
}

export function updatedMoreThan(updatedAt: string, now: number, staleMs: number): boolean {
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return false;
  return now - updated > staleMs;
}

export function translationWatchAction(order: WatchOrder, now: number): WatchAction {
  if ((order.orderType !== "translation" || order.service) && order.includeTranslation !== true) return "ignore";
  if (order.reviewReason === TRANSLATION_TIMEOUT_REASON) return "ignore";
  if (CLOSED.has(order.status)) return "ignore";
  if (!updatedMoreThan(order.updatedAt, now, TRANSLATION_STALE_MS)) return "ignore";
  const translating = progressStep(order.progress) === "translating";
  if (!translating && !PRE_PREVIEW.has(order.status)) return "ignore";
  return progressRetries(order.progress) >= 1 ? "flag" : "retry";
}

/** True once a preview has been missing for more than 4 minutes. */
export function isPreviewDelayed(input: {
  status: string;
  previewVersion: number | null;
  updatedAt: string;
  progress: unknown;
  now: number;
  reviewReason?: string | null;
}): boolean {
  if (input.previewVersion != null) return false;
  if (input.status === "needs_review" && input.reviewReason === TRANSLATION_TIMEOUT_REASON) return true;
  if (!WAITING_FOR_PREVIEW.has(input.status)) return false;
  if (progressRetries(input.progress) >= 1) return true;
  return updatedMoreThan(input.updatedAt, input.now, TRANSLATION_STALE_MS);
}

export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  return authorization === `Bearer ${secret}`;
}

export type WatchPatch =
  | { kind: "retry"; progress: CheckedProgress }
  | { kind: "flag"; progress: CheckedProgress };

/** Decides retry vs flag, then asks the caller to persist the row before translating. */
export async function applyTranslationWatch(input: {
  orders: WatchOrder[];
  now: number;
  save: (order: WatchOrder, patch: WatchPatch) => Promise<boolean>;
  translate: (orderId: string) => Promise<void>;
}): Promise<{ retried: string[]; flagged: string[] }> {
  const retried: string[] = [];
  const flagged: string[] = [];
  for (const order of input.orders) {
    const action = translationWatchAction(order, input.now);
    if (action === "ignore") continue;
    if (action === "flag") {
      const saved = await input.save(order, {
        kind: "flag",
        progress: checkedProgress(order.progress, { step: "done" }),
      });
      if (saved) flagged.push(order.id);
      continue;
    }
    const saved = await input.save(order, {
      kind: "retry",
      progress: checkedProgress(order.progress, {
        step: "translating",
        retries: progressRetries(order.progress) + 1,
      }),
    });
    if (!saved) continue;
    retried.push(order.id);
    try {
      await input.translate(order.id);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "translation retry failed");
    }
  }
  return { retried, flagged };
}
