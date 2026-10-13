/** Four opens: the first try, then three waits that add up to 10 seconds. */
export const PREVIEW_LOAD_ATTEMPTS = 4;

export const PREVIEW_RETRY_DELAYS_MS = [2000, 3000, 5000] as const;

/**
 * Delay before a 0-based attempt. The first attempt waits nothing.
 * Attempts past the budget return null so the caller stops.
 */
export function delayBeforePreviewAttempt(attempt: number): number | null {
  if (attempt <= 0) return 0;
  if (attempt >= PREVIEW_LOAD_ATTEMPTS) return null;
  return PREVIEW_RETRY_DELAYS_MS[attempt - 1] ?? null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A preview PDF that is missing, empty, or not written yet. */
export class PreviewFileNotReady extends Error {
  constructor(message = "The preview file is not ready.") {
    super(message);
    this.name = "PreviewFileNotReady";
  }
}

/**
 * Download a preview PDF without using the HTTP cache.
 * A 404, a network error, or an empty body is retryable: the file may
 * still be landing right after checkout. Signed URLs are fetched as given.
 */
export async function fetchPreviewFile(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    throw new PreviewFileNotReady(cause instanceof Error ? cause.message : "The preview file is not ready.");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PreviewFileNotReady(`Preview file failed to load (${response.status}).`);
  }

  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null && Number(lengthHeader) === 0) {
    await response.body?.cancel().catch(() => undefined);
    throw new PreviewFileNotReady("Preview file was empty.");
  }

  const blob = await response.blob();
  if (blob.size === 0) throw new PreviewFileNotReady("Preview file was empty.");
  return blob;
}
