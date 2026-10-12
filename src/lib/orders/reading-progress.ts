export const READING_STEPS = [
  "uploaded",
  "reading",
  "language",
  "counting",
  "quoting",
  "done",
] as const;

export type ReadingStep = (typeof READING_STEPS)[number];

/** Steps the customer sees. `done` completes the list only after the quote exists. */
export const READING_LIST = [
  { id: "uploaded", label: "Uploaded" },
  { id: "reading", label: "Reading pages" },
  { id: "language", label: "Detecting language" },
  { id: "counting", label: "Counting translatable text" },
  { id: "quoting", label: "Building your quote" },
] as const;

export type ReadingListStep = (typeof READING_LIST)[number]["id"];

export type OrderReadProgress = {
  step: ReadingStep;
  pagesRead?: number;
  pagesTotal?: number;
};

/**
 * Progress stored on the order. `translating` is the post-quote job.
 * `pagesRead` and `pagesTotal` stay the OCR counts.
 * `pagesDone` and `pagesTranslateTotal` count billable pages during translation.
 * `retries` stays off the public payload.
 */
export type OrderProgress = {
  step: ReadingStep | "translating";
  pagesRead: number;
  pagesTotal: number;
  retries?: number;
  pagesDone?: number;
  pagesTranslateTotal?: number;
};

export const UPLOADED_PROGRESS: OrderProgress = { step: "uploaded", pagesRead: 0, pagesTotal: 0 };

function integerCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function storedRetries(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function translationCounts(row: Record<string, unknown>): {
  pagesDone?: number;
  pagesTranslateTotal?: number;
} {
  const pagesDone = integerCount(row.pagesDone);
  const pagesTranslateTotal = integerCount(row.pagesTranslateTotal);
  const done = pagesDone != null && pagesDone >= 0 ? pagesDone : undefined;
  const total = pagesTranslateTotal != null && pagesTranslateTotal >= 0 ? pagesTranslateTotal : undefined;
  if (done == null && total == null) return {};
  if (done != null && total != null && done > total) return { pagesDone: total, pagesTranslateTotal: total };
  return {
    ...(done != null ? { pagesDone: done } : {}),
    ...(total != null ? { pagesTranslateTotal: total } : {}),
  };
}

/** Full progress object, or null when the payload is missing a step or an integer count. */
export function asOrderProgress(value: unknown): OrderProgress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const pagesRead = integerCount(row.pagesRead);
  const pagesTotal = integerCount(row.pagesTotal);
  if (pagesRead == null || pagesTotal == null || pagesRead < 0 || pagesTotal < 0) return null;
  const retries = storedRetries(row.retries);
  const extra = {
    ...(retries == null ? {} : { retries }),
    ...translationCounts(row),
  };
  if (row.step === "translating") return { step: "translating", pagesRead, pagesTotal, ...extra };
  if (typeof row.step !== "string" || !STEP_SET.has(row.step)) return null;
  return { step: row.step as ReadingStep, pagesRead, pagesTotal, ...extra };
}

export type StepState = "done" | "current" | "pending";

export type ReadingPresentation = {
  /** Bar width, 0–100. Stays below 100 until the order is quoted. */
  percent: number;
  /** Integer shown beside the bar. Fallback stays at or below 89. */
  displayPercent: number;
  label: string;
  steps: Array<{ id: ReadingListStep; label: string; state: StepState }>;
};

const STEP_SET = new Set<string>(READING_STEPS);

/** Time constant for the fallback ease toward 90%. About 86% at 60s. */
const FALLBACK_EASE_MS = 20_000;
const FALLBACK_CAP = 89.9;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readOrderProgress(value: unknown): OrderReadProgress | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.step !== "string" || !STEP_SET.has(row.step)) return null;
  const pagesRead = finiteNumber(row.pagesRead);
  const pagesTotal = finiteNumber(row.pagesTotal);
  return {
    step: row.step as ReadingStep,
    ...(pagesRead !== undefined ? { pagesRead } : {}),
    ...(pagesTotal !== undefined ? { pagesTotal } : {}),
  };
}

function readRatio(progress: OrderReadProgress): number {
  const total = progress.pagesTotal;
  const read = progress.pagesRead;
  if (total == null || read == null || total <= 0) return 0;
  return Math.min(1, Math.max(0, read / total));
}

/** Percent for a progress payload, including 100 for `done`. */
export function liveReadingPercent(progress: OrderReadProgress): number {
  switch (progress.step) {
    case "uploaded":
      return 5;
    case "reading":
      return 5 + 55 * readRatio(progress);
    case "language":
      return 70;
    case "counting":
      return 90;
    case "quoting":
      return 95;
    case "done":
      return 100;
  }
}

/** Ease toward 90% and stay under it. */
export function fallbackReadingPercent(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const eased = 90 * (1 - Math.exp(-elapsed / FALLBACK_EASE_MS));
  return Math.min(FALLBACK_CAP, eased);
}

function fallbackStep(percent: number): ReadingListStep {
  if (percent >= 80) return "quoting";
  if (percent >= 70) return "counting";
  if (percent >= 60) return "language";
  if (percent >= 5) return "reading";
  return "uploaded";
}

function readingLabel(progress: OrderReadProgress): string {
  if (progress.step === "reading") {
    const total = progress.pagesTotal;
    const read = progress.pagesRead;
    if (total != null && read != null && total > 0 && read > 0) {
      const pages = Math.max(1, Math.round(total));
      const page = Math.min(pages, Math.max(1, Math.round(read)));
      return `Reading page ${page} of ${pages}`;
    }
    return "Reading pages";
  }
  if (progress.step === "done") return "Building your quote";
  return READING_LIST.find((step) => step.id === progress.step)?.label ?? "Uploaded";
}

function stepStates(current: ReadingListStep, complete: boolean): ReadingPresentation["steps"] {
  const index = READING_LIST.findIndex((step) => step.id === current);
  return READING_LIST.map((step, position) => ({
    id: step.id,
    label: step.label,
    state: complete ? "done" : position < index ? "done" : position === index ? "current" : "pending",
  }));
}

/** Time constant for the upload ease toward 5% when the browser reports no byte progress. */
const UPLOAD_EASE_MS = 2_500;
const UPLOAD_CAP = 4.9;

/** Ease toward 5% and stay under it until the upload reports real progress. */
export function uploadFallbackPercent(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const eased = 5 * (1 - Math.exp(-elapsed / UPLOAD_EASE_MS));
  return Math.min(UPLOAD_CAP, eased);
}

/**
 * The 0–5% stage while the order does not exist yet.
 * `ratio` is upload bytes loaded/total when the browser can report it; otherwise pass null to ease.
 */
export function uploadReadingPresentation(input: {
  ratio: number | null;
  elapsedMs: number;
}): ReadingPresentation {
  const live = typeof input.ratio === "number" && Number.isFinite(input.ratio);
  const percent = live
    ? Math.min(5, Math.max(0, input.ratio as number) * 5)
    : uploadFallbackPercent(input.elapsedMs);
  return {
    percent,
    displayPercent: live ? Math.round(percent) : Math.min(4, Math.round(percent)),
    label: "Uploading",
    steps: stepStates("uploaded", false).map((step) =>
      step.id === "uploaded" ? { ...step, label: "Uploading" } : step,
    ),
  };
}

export function readingPresentation(input: {
  progress: unknown;
  status: string;
  elapsedMs: number;
}): ReadingPresentation {
  if (input.status === "quoted") {
    return {
      percent: 100,
      displayPercent: 100,
      label: "Building your quote",
      steps: stepStates("quoting", true),
    };
  }

  const progress = readOrderProgress(input.progress);
  if (progress) {
    const raw = liveReadingPercent(progress);
    const percent = raw >= 100 ? 95 : raw;
    const current: ReadingListStep = progress.step === "done" ? "quoting" : progress.step;
    return {
      percent,
      displayPercent: Math.round(percent),
      label: readingLabel(progress.step === "done" ? { ...progress, step: "quoting" } : progress),
      steps: stepStates(current, false),
    };
  }

  const percent = fallbackReadingPercent(input.elapsedMs);
  const current = fallbackStep(percent);
  return {
    percent,
    displayPercent: Math.min(89, Math.round(percent)),
    label: readingLabel({ step: current }),
    steps: stepStates(current, false),
  };
}
