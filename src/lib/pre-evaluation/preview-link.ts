/** Signed preview URLs last 5 minutes. Ask for a new one 30 seconds before that. */
export const PREVIEW_LINK_TTL_MS = 300_000;

export const PREVIEW_LINK_REFRESH_LEAD_MS = 30_000;

export const PREVIEW_LINK_REFRESH_AT_MS = PREVIEW_LINK_TTL_MS - PREVIEW_LINK_REFRESH_LEAD_MS;

export function previewLinkIsStale(issuedAt: number, now: number): boolean {
  return now - issuedAt >= PREVIEW_LINK_REFRESH_AT_MS;
}

export function previewLinkRefreshDelay(issuedAt: number, now: number): number {
  return Math.max(0, issuedAt + PREVIEW_LINK_REFRESH_AT_MS - now);
}

/**
 * While the tab is visible, call `onRefresh` once as the signed link nears expiry.
 * A hidden tab waits. Showing it again refreshes immediately when the link is already stale.
 */
export function watchPreviewLink(input: {
  issuedAt: number;
  onRefresh: () => void;
  isVisible?: () => boolean;
  listen?: (onChange: () => void) => () => void;
  now?: () => number;
}): () => void {
  const isVisible = input.isVisible ?? (() => true);
  const now = input.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const clear = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const arm = () => {
    clear();
    if (closed || !isVisible()) return;
    const delay = previewLinkRefreshDelay(input.issuedAt, now());
    timer = setTimeout(() => {
      timer = undefined;
      if (closed || !isVisible()) return;
      input.onRefresh();
    }, delay);
  };

  const onVisibility = () => {
    if (closed) return;
    if (!isVisible()) {
      clear();
      return;
    }
    if (previewLinkIsStale(input.issuedAt, now())) {
      clear();
      input.onRefresh();
      return;
    }
    arm();
  };

  arm();
  const stopListening = input.listen?.(onVisibility);
  return () => {
    closed = true;
    clear();
    stopListening?.();
  };
}
