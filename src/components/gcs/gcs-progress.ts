import { previewWork, translatingEase, type PreviewWork } from "@/lib/flow/preview-progress";
import { uploadReadingPresentation } from "@/lib/orders/reading-progress";

/** Fields read from `GET /api/orders/[token]` while a GCS translation is running. */
export type GcsOrderSnapshot = {
  status?: string | null;
  orderType?: string | null;
  progressPct?: number | null;
  progressStage?: string | null;
  progress?: {
    step?: string | null;
    pagesRead?: number | null;
    pagesTotal?: number | null;
    pagesDone?: number | null;
    pagesTranslateTotal?: number | null;
  } | null;
};

export type GcsLiveProgress = {
  progressPct: number;
  progressStage: string;
  /** Fill width. Stays fractional while `progressPct` is the rounded label. */
  barPercent: number;
  steps: PreviewWork["steps"];
};

const WAITING_STAGE = "Reading the document and starting the translation.";

function finitePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function cleanStage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function elapsedMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundPercent(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)));
}

function hasBillablePages(order: GcsOrderSnapshot): boolean {
  const total = order.progress?.pagesTranslateTotal;
  const done = order.progress?.pagesDone;
  return (
    typeof total === "number" &&
    Number.isFinite(total) &&
    total > 0 &&
    typeof done === "number" &&
    Number.isFinite(done) &&
    done >= 0
  );
}

/**
 * Live bar for `/gcs-translate/[token]` before the side-by-side viewer exists.
 * `progressPct` and `progressStage` are taken from the order payload when
 * `/api/orders/[token]` sends them. Otherwise they follow `progress` the same
 * way CredPronto's translation screen does. A translating order with no
 * billable page ratio eases from 92 toward 98 so the bar keeps moving.
 */
export function gcsTranslationProgress(order: GcsOrderSnapshot | null, elapsed: number): GcsLiveProgress {
  const progress = order?.progress;
  const work = previewWork({
    status: order?.status || "processing",
    orderType: order?.orderType ?? "translation",
    progressStep: progress?.step,
    pagesRead: progress?.pagesRead,
    pagesTotal: progress?.pagesTotal,
    pagesDone: progress?.pagesDone,
    pagesTranslateTotal: progress?.pagesTranslateTotal,
    translatingElapsedMs: elapsedMs(elapsed),
  });

  if (!order) {
    const wait = elapsedMs(elapsed);
    const barPercent = Math.min(12, 5 + 7 * (1 - Math.exp(-wait / 5_000)));
    return {
      progressPct: roundPercent(barPercent),
      progressStage: WAITING_STAGE,
      barPercent,
      steps: work.steps,
    };
  }

  if (work.phase === "review") {
    return { progressPct: 0, progressStage: work.label, barPercent: 0, steps: work.steps };
  }

  const apiPct = finitePercent(order.progressPct);
  const apiStage = cleanStage(order.progressStage);
  const translating =
    progress?.step === "translating" ||
    (progress?.step == null && apiStage != null && /translat/i.test(apiStage));

  let barPercent = work.percent;
  if (apiPct != null || apiStage != null) {
    const base = apiPct ?? work.percent;
    if (work.phase === "ready") barPercent = 100;
    else if (translating && !hasBillablePages(order)) {
      barPercent = Math.min(98, Math.max(base, translatingEase(elapsedMs(elapsed))));
    } else barPercent = Math.max(base, work.percent);
  }

  return {
    progressPct: roundPercent(barPercent),
    progressStage: apiStage ?? work.label,
    barPercent,
    steps: work.steps,
  };
}

/** Byte upload, then the pause while the order is created and started. */
export function gcsUploadProgress(input: {
  ratio: number | null;
  elapsedMs: number;
  creating: boolean;
}): GcsLiveProgress {
  const elapsed = elapsedMs(input.elapsedMs);
  if (input.creating) {
    const barPercent = Math.min(18, 5 + 13 * (1 - Math.exp(-elapsed / 6_000)));
    return {
      progressPct: roundPercent(barPercent),
      progressStage: "Starting the translation",
      barPercent,
      steps: [],
    };
  }
  const view = uploadReadingPresentation({ ratio: input.ratio, elapsedMs: elapsed });
  return {
    progressPct: view.displayPercent,
    progressStage: view.label,
    barPercent: view.percent,
    steps: [],
  };
}
