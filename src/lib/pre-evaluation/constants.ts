/** One anonymous diploma or transcript. */
export const PRE_EVAL_MAX_BYTES = 10 * 1024 * 1024;

/** Successful uploads for one network during one UTC day. */
export const PRE_EVAL_DAILY_UPLOADS = 5;

/** New lead emails for one network during one UTC day. */
export const PRE_EVAL_DAILY_EMAILS = 10;

/** Another worker may retry a suggestion that has been quiet this long. */
export const PRE_EVAL_STALE_MS = 2 * 60 * 1000;

/** Signed URL lifetime for the watermarked preview. Minted again on each read. */
export const PRE_EVAL_PREVIEW_URL_SECONDS = 300;

/** Short windows shared by every instance. Counts live in the database, not in memory. */
export const PRE_EVAL_BURST = {
  upload: { windowMs: 10 * 60 * 1000, max: 3 },
  email: { windowMs: 10 * 60 * 1000, max: 5 },
  read: { windowMs: 60_000, max: 120 },
} as const;

export type PreEvalBurstKind = keyof typeof PRE_EVAL_BURST;

export const PRE_EVAL_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const;

export type PreEvalMime = (typeof PRE_EVAL_MIMES)[number];

export type PreEvalConfidence = "high" | "medium" | "low";

export type PreEvalStatus = "processing" | "ready" | "failed";
