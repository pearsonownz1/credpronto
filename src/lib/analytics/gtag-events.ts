import {
  claimOrderEvent,
  previewReadyEventParams,
  uploadEventParams,
  type AdsEventName,
} from "@/lib/analytics/google-ads";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const claimed = new Set<string>();

export function claimAdsEvent(event: AdsEventName, orderId: string): boolean {
  const memoryKey = `${event}:${orderId}`;
  if (claimed.has(memoryKey)) return false;
  try {
    if (!claimOrderEvent(event, orderId, sessionStorage)) {
      claimed.add(memoryKey);
      return false;
    }
  } catch {
    // Private browsing can reject sessionStorage. The in-memory set still
    // stops a second fire during this page view.
  }
  claimed.add(memoryKey);
  return true;
}

export function pushGtagEvent(name: string, params: object) {
  const dataLayer = (window.dataLayer = window.dataLayer || []);
  const gtag =
    typeof window.gtag === "function"
      ? window.gtag
      : (...args: unknown[]) => {
          dataLayer.push(args);
        };
  window.gtag = gtag;
  gtag("event", name, params);
}

/** Order created after a file upload. Page count is omitted when it is not known yet. */
export function trackOrderUpload(orderId: string, pageCount: number | null) {
  if (!orderId) return;
  if (!claimAdsEvent("upload", orderId)) return;
  pushGtagEvent("upload", uploadEventParams(orderId, pageCount));
}

/** First time this page view sees preview_ready for the order. */
export function trackPreviewReady(order: {
  orderId: string;
  status: string;
  totalCents: number | null;
}) {
  const params = previewReadyEventParams(order);
  if (!params) return;
  if (!claimAdsEvent("preview_ready", order.orderId)) return;
  pushGtagEvent("preview_ready", params);
}
