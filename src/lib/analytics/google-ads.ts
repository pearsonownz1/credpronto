/** Google Ads account. Override with NEXT_PUBLIC_GOOGLE_ADS_ID (AW- plus digits). */
export const GOOGLE_ADS_ID = "AW-18508202440";

const ADS_ID = /^AW-\d+$/;

/** How long to wait between unpaid order checks on the Stripe return URL. */
export const CONVERSION_POLL_MS = 2000;

const CONVERSION_STORAGE_PREFIX = "credpronto:google-ads-conversion:";

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

/** Empty when NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL is unset. */
export function googleAdsConversionLabel(): string | null {
  const label = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABEL?.trim();
  return label ? label : null;
}

export function googleAdsScriptSrc(id: string = googleAdsId()): string {
  return `https://www.googletagmanager.com/gtag/js?id=${id}`;
}

export function googleAdsInlineSnippet(id: string = googleAdsId()): string {
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');`;
}

export function conversionStorageKey(orderId: string): string {
  return `${CONVERSION_STORAGE_PREFIX}${orderId}`;
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

/** True the first time this order is claimed in the store. */
export function claimConversion(orderId: string, store: KeyValueStore): boolean {
  const key = conversionStorageKey(orderId);
  if (store.getItem(key) === "1") return false;
  store.setItem(key, "1");
  return true;
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
