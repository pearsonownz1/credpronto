/** Signed preview URLs last 5 minutes. Ask for a new one 30 seconds before that. */
export const PREVIEW_LINK_TTL_MS = 300_000;

export const PREVIEW_LINK_REFRESH_LEAD_MS = 30_000;

export const PREVIEW_LINK_REFRESH_AT_MS = PREVIEW_LINK_TTL_MS - PREVIEW_LINK_REFRESH_LEAD_MS;

/**
 * After the scheduled refresh fails, retry while the tab is visible.
 * Three tries, then the page shows the error state.
 */
export const PREVIEW_LINK_BACKOFF_MS = [5_000, 15_000, 30_000] as const;

export const PREVIEW_LINK_REFRESH_RETRY_LIMIT = PREVIEW_LINK_BACKOFF_MS.length;

export function previewLinkIsStale(issuedAt: number, now: number): boolean {
  return now - issuedAt >= PREVIEW_LINK_REFRESH_AT_MS;
}

export function previewLinkRefreshDelay(issuedAt: number, now: number): number {
  return Math.max(0, issuedAt + PREVIEW_LINK_REFRESH_AT_MS - now);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * While the tab is visible, call `onRefresh` as the signed link nears expiry.
 * A hidden tab waits. Showing it again refreshes immediately when the link is already stale.
 * A failed refresh retries at 5s, 15s, and 30s while visible. After those three
 * tries, `onExhausted` runs so the page can show its error state.
 */
export function watchPreviewLink(input: {
  issuedAt: number;
  getIssuedAt?: () => number;
  onRefresh: () => Promise<"stop" | void> | "stop" | void;
  onExhausted?: () => void;
  isVisible?: () => boolean;
  listen?: (onChange: () => void) => () => void;
  now?: () => number;
}): () => void {
  const isVisible = input.isVisible ?? (() => true);
  const now = input.now ?? (() => Date.now());
  const issuedAt = input.getIssuedAt ?? (() => input.issuedAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let running = false;
  let retriesScheduled = 0;
  let retryDueAt: number | null = null;
  let owed = false;

  const clear = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const arm = (delay: number) => {
    clear();
    if (closed || !isVisible()) return;
    timer = setTimeout(() => {
      timer = undefined;
      void fire();
    }, delay);
  };

  const exhaust = () => {
    closed = true;
    clear();
    retryDueAt = null;
    owed = false;
    input.onExhausted?.();
  };

  const scheduleRetry = () => {
    if (retriesScheduled >= PREVIEW_LINK_REFRESH_RETRY_LIMIT) {
      exhaust();
      return;
    }
    const delay = PREVIEW_LINK_BACKOFF_MS[retriesScheduled] ?? PREVIEW_LINK_BACKOFF_MS[PREVIEW_LINK_BACKOFF_MS.length - 1];
    retriesScheduled += 1;
    retryDueAt = now() + delay;
    owed = false;
    arm(delay);
  };

  const fail = () => {
    if (retriesScheduled >= PREVIEW_LINK_REFRESH_RETRY_LIMIT) {
      exhaust();
      return;
    }
    if (!isVisible()) {
      owed = true;
      return;
    }
    scheduleRetry();
  };

  async function fire(): Promise<void> {
    if (closed || running || !isVisible()) return;
    running = true;
    clear();
    retryDueAt = null;
    let failed = false;
    let halt = false;
    try {
      halt = (await input.onRefresh()) === "stop";
    } catch (error) {
      if (closed || isAbortError(error)) {
        running = false;
        return;
      }
      failed = true;
    }
    running = false;
    if (closed || halt) return;
    if (failed) {
      fail();
      return;
    }
    retriesScheduled = 0;
    owed = false;
    if (!isVisible()) return;
    const delay = previewLinkRefreshDelay(issuedAt(), now());
    if (delay > 0) arm(delay);
  }

  const onVisibility = () => {
    if (closed || running) return;
    clear();
    if (!isVisible()) return;
    if (retryDueAt != null) {
      const wait = Math.max(0, retryDueAt - now());
      if (wait === 0) void fire();
      else arm(wait);
      return;
    }
    if (owed) {
      scheduleRetry();
      return;
    }
    if (previewLinkIsStale(issuedAt(), now())) {
      void fire();
      return;
    }
    arm(previewLinkRefreshDelay(issuedAt(), now()));
  };

  onVisibility();
  const stopListening = input.listen?.(onVisibility);
  return () => {
    closed = true;
    clear();
    stopListening?.();
  };
}
