/** Google Ads account. Override with NEXT_PUBLIC_GOOGLE_ADS_ID (AW- plus digits). */
export const GOOGLE_ADS_ID = "AW-18508202440";

const ADS_ID = /^AW-\d+$/;

/** How long to wait between unpaid order checks on the Stripe return URL. */
export const CONVERSION_POLL_MS = 2000;

const EVENT_PREFIX = {
  conversion: "credpronto:google-ads-conversion:",
  upload: "credpronto:google-ads-upload:",
  preview_ready: "credpronto:google-ads-preview-ready:",
} as const;

export type AdsEventName = keyof typeof EVENT_PREFIX;

export type GoogleAdsConversion = {
  send_to: string;
  value: number;
  currency: "USD";
  transaction_id: string;
};

export type OrderPaymentSnapshot = {
  orderId: string;
  totalCents: number | null;
  paymentStatus: string | null;
};

export type ConversionDecision =
  | { action: "fire"; payload: GoogleAdsConversion }
  | { action: "wait" }
  | { action: "skip" };

export function googleAdsId(): string {
  const override = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID?.trim();
  if (override && ADS_ID.test(override)) return override;
  return GOOGLE_ADS_ID;
}

/**
 * Purchase conversion label. `NEXT_PUBLIC_GADS_PURCHASE_LABEL` wins.
 * `NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL` is the fallback. Empty when both are unset.
 */
export function googleAdsConversionLabel(): string | null {
  const purchase = process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL?.trim();
  if (purchase) return purchase;
  const fallback = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL?.trim();
  return fallback ? fallback : null;
}

export function googleAdsScriptSrc(id: string = googleAdsId()): string {
  return `https://www.googletagmanager.com/gtag/js?id=${id}`;
}

export function googleAdsInlineSnippet(id: string = googleAdsId()): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');`;
}

export function eventStorageKey(event: AdsEventName, orderId: string): string {
  return `${EVENT_PREFIX[event]}${orderId}`;
}

export function conversionStorageKey(orderId: string): string {
  return eventStorageKey("conversion", orderId);
}

/** Sum of page counts when every file has one. Otherwise the total is unknown. */
export function knownPageCount(pages: Array<number | null | undefined>): number | null {
  if (pages.length === 0) return null;
  let total = 0;
  for (const count of pages) {
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
    total += count;
  }
  return total;
}

export function uploadEventParams(
  orderId: string,
  pageCount: number | null | undefined,
): { order_id: string; page_count?: number } {
  if (typeof pageCount === "number" && Number.isFinite(pageCount) && pageCount >= 0) {
    return { order_id: orderId, page_count: pageCount };
  }
  return { order_id: orderId };
}

export function previewReadyEventParams(order: {
  orderId: string;
  status: string;
  totalCents: number | null;
}): { order_id: string; value?: number; currency: "USD" } | null {
  if (order.status !== "preview_ready" || order.orderId.length === 0) return null;
  const params: { order_id: string; value?: number; currency: "USD" } = {
    order_id: order.orderId,
    currency: "USD",
  };
  if (typeof order.totalCents === "number" && Number.isFinite(order.totalCents)) {
    params.value = order.totalCents / 100;
  }
  return params;
}

export function readOrderPayment(body: unknown): OrderPaymentSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.orderId !== "string" || record.orderId.length === 0) return null;

  const totalCents =
    typeof record.totalCents === "number" && Number.isFinite(record.totalCents)
      ? record.totalCents
      : null;

  let paymentStatus: string | null = null;
  const payment = record.payment;
  if (payment && typeof payment === "object") {
    const status = (payment as { status?: unknown }).status;
    if (typeof status === "string" && status.length > 0) paymentStatus = status;
  }

  return { orderId: record.orderId, totalCents, paymentStatus };
}

/**
 * Fire only after GET /api/orders/{token} reports payment status `paid`.
 * `pending` (and a missing payment) keep polling; anything else stops.
 * The label must be set or the event is skipped.
 */
export function decideConversion(
  order: OrderPaymentSnapshot,
  adsId: string,
  label: string | null,
): ConversionDecision {
  if (!label) return { action: "skip" };
  if (order.paymentStatus === "paid") {
    if (order.totalCents == null) return { action: "skip" };
    return {
      action: "fire",
      payload: {
        send_to: `${adsId}/${label}`,
        value: order.totalCents / 100,
        currency: "USD",
        transaction_id: order.orderId,
      },
    };
  }
  if (order.paymentStatus == null || order.paymentStatus === "pending") {
    return { action: "wait" };
  }
  return { action: "skip" };
}

type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** True the first time this order is claimed for the event. */
export function claimOrderEvent(
  event: AdsEventName,
  orderId: string,
  store: KeyValueStore,
): boolean {
  const key = eventStorageKey(event, orderId);
  if (store.getItem(key) === "1") return false;
  store.setItem(key, "1");
  return true;
}

/** True the first time this paid order is claimed in the store. */
export function claimConversion(orderId: string, store: KeyValueStore): boolean {
  return claimOrderEvent("conversion", orderId, store);
}

export type TrackConversionOptions = {
  token: string;
  adsId: string;
  label: string | null;
  signal: AbortSignal;
  fetchOrder: (token: string, signal: AbortSignal) => Promise<unknown>;
  claim: (orderId: string) => boolean;
  push: (payload: GoogleAdsConversion) => void;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
};

/**
 * Poll GET /api/orders/{token} until the payment is settled, then push one
 * conversion. `fetchOrder` resolves to `null` when the order cannot be loaded
 * (stop) and throws on a transient failure (retry).
 */
export async function trackPaidOrderConversion(options: TrackConversionOptions): Promise<void> {
  if (!options.label) return;

  for (;;) {
    if (options.signal.aborted) return;

    let body: unknown;
    try {
      body = await options.fetchOrder(options.token, options.signal);
    } catch {
      if (options.signal.aborted) return;
      await options.sleep(CONVERSION_POLL_MS, options.signal);
      continue;
    }

    if (options.signal.aborted) return;
    if (body == null) return;

    const order = readOrderPayment(body);
    if (!order) return;

    const decision = decideConversion(order, options.adsId, options.label);
    if (decision.action === "skip") return;
    if (decision.action === "fire") {
      if (options.claim(order.orderId)) options.push(decision.payload);
      return;
    }

    await options.sleep(CONVERSION_POLL_MS, options.signal);
  }
}
