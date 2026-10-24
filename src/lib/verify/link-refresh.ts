import { SIGNED_PDF_TTL_SECONDS, isAbortError, type Verification } from "./client";

/** Re-read the verify API this long before the 300s signed URL expires. An iframe PDF never fires onError. */
export const VIEWER_REFRESH_BEFORE_EXPIRY_SECONDS = 30;

/** Download asks for a new link earlier, so the transfer is not still using a URL near expiry. */
export const DOWNLOAD_REFRESH_BEFORE_EXPIRY_SECONDS = 60;

export const VIEWER_REFRESH_AFTER_MS = (SIGNED_PDF_TTL_SECONDS - VIEWER_REFRESH_BEFORE_EXPIRY_SECONDS) * 1000;

export const DOWNLOAD_REFRESH_AFTER_MS = (SIGNED_PDF_TTL_SECONDS - DOWNLOAD_REFRESH_BEFORE_EXPIRY_SECONDS) * 1000;

/**
 * After the scheduled refresh fails, retry while the tab is visible.
 * Three tries, then the page shows the error state.
 */
export const REFRESH_BACKOFF_MS = [5_000, 15_000, 30_000] as const;

export const REFRESH_RETRY_LIMIT = REFRESH_BACKOFF_MS.length;

export function viewerRefreshDelay(fetchedAt: number, now = Date.now()): number {
  return Math.max(0, VIEWER_REFRESH_AFTER_MS - (now - fetchedAt));
}

export function downloadNeedsFreshLink(fetchedAt: number, now = Date.now()): boolean {
  return now - fetchedAt >= DOWNLOAD_REFRESH_AFTER_MS;
}

/** A refetched PDF has a new signed URL, so its age starts now. */
export function fetchedAtAfterRead(retried: boolean, fetchedAt: number): number {
  return retried ? Date.now() : fetchedAt;
}

export type SignedView = {
  documentUrl: string | null;
  viewerUrl: string | null;
  remote: boolean;
  fetchedAt: number;
};

export function viewAfterRefresh(
  current: SignedView,
  verification: Verification,
  now: number,
): { outcome: "revoked" } | { outcome: "not_found" } | { outcome: "valid"; view: SignedView } {
  if (verification.status === "revoked") return { outcome: "revoked" };
  if (verification.status !== "valid") return { outcome: "not_found" };
  const documentUrl = verification.documentUrl;
  const showSignedUrl = current.remote || !current.viewerUrl;
  return {
    outcome: "valid",
    view: {
      documentUrl,
      fetchedAt: now,
      remote: showSignedUrl && Boolean(documentUrl),
      viewerUrl: showSignedUrl ? documentUrl : current.viewerUrl,
    },
  };
}

export async function linkForDownload<T extends { documentUrl: string | null }>(input: {
  fetchedAt: number;
  documentUrl: string | null;
  now?: number;
  refresh: () => Promise<{ fetchedAt: number; verification: T }>;
}): Promise<
  | { refreshed: false; fetchedAt: number; documentUrl: string }
  | { refreshed: true; fetchedAt: number; verification: T }
> {
  const now = input.now ?? Date.now();
  if (input.documentUrl && !downloadNeedsFreshLink(input.fetchedAt, now)) {
    return { refreshed: false, fetchedAt: input.fetchedAt, documentUrl: input.documentUrl };
  }
  const next = await input.refresh();
  return { refreshed: true, fetchedAt: next.fetchedAt, verification: next.verification };
}

export type LinkWatch = {
  stop: () => void;
  onVisibility: () => void;
};

/**
 * While the tab is visible, call `refresh` when the signed URL reaches ~270s.
 * A hidden tab does not call. `onVisibility` runs the refresh immediately when
 * the tab returns and the link is already due.
 * A failed refresh retries at 5s, 15s, and 30s while visible. After those three
 * tries, `onExhausted` runs so the page can show its error state.
 */
export function watchSignedLink(input: {
  getFetchedAt: () => number;
  isVisible: () => boolean;
  refresh: () => Promise<"stop" | void> | "stop" | void;
  onExhausted: () => void;
  now?: () => number;
}): LinkWatch {
  const currentNow = input.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let running = false;
  let retriesScheduled = 0;
  let retryDueAt: number | null = null;
  let owed = false;

  function clear(): void {
    if (timer == null) return;
    clearTimeout(timer);
    timer = null;
  }

  function arm(delay: number): void {
    clear();
    if (stopped || !input.isVisible()) return;
    timer = setTimeout(() => {
      timer = null;
      void fire();
    }, delay);
  }

  function exhaust(): void {
    stopped = true;
    clear();
    retryDueAt = null;
    owed = false;
    input.onExhausted();
  }

  function scheduleRetry(): void {
    if (retriesScheduled >= REFRESH_RETRY_LIMIT) {
      exhaust();
      return;
    }
    const delay = REFRESH_BACKOFF_MS[retriesScheduled] ?? REFRESH_BACKOFF_MS[REFRESH_BACKOFF_MS.length - 1];
    retriesScheduled += 1;
    retryDueAt = currentNow() + delay;
    owed = false;
    arm(delay);
  }

  function fail(): void {
    if (retriesScheduled >= REFRESH_RETRY_LIMIT) {
      exhaust();
      return;
    }
    if (!input.isVisible()) {
      owed = true;
      return;
    }
    scheduleRetry();
  }

  async function fire(): Promise<void> {
    if (stopped || running || !input.isVisible()) return;
    running = true;
    clear();
    retryDueAt = null;
    let failed = false;
    let halt = false;
    try {
      halt = (await input.refresh()) === "stop";
    } catch (error) {
      if (stopped || isAbortError(error)) {
        running = false;
        return;
      }
      failed = true;
    }
    running = false;
    if (stopped || halt) return;
    if (failed) {
      fail();
      return;
    }
    retriesScheduled = 0;
    owed = false;
    if (!input.isVisible()) return;
    const delay = viewerRefreshDelay(input.getFetchedAt(), currentNow());
    if (delay > 0) arm(delay);
  }

  function onVisibility(): void {
    if (stopped || running) return;
    clear();
    if (!input.isVisible()) return;
    if (retryDueAt != null) {
      const wait = Math.max(0, retryDueAt - currentNow());
      if (wait === 0) void fire();
      else arm(wait);
      return;
    }
    if (owed) {
      scheduleRetry();
      return;
    }
    const delay = viewerRefreshDelay(input.getFetchedAt(), currentNow());
    if (delay === 0) void fire();
    else arm(delay);
  }

  onVisibility();
  return { stop, onVisibility };

  function stop(): void {
    stopped = true;
    clear();
  }
}
