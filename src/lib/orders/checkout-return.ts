const PROD_HOSTS = new Set(["credpronto.com", "www.credpronto.com"]);
const PREVIEW_HOST = /^[a-z0-9-]+-guy-gcsorgs-projects\.vercel\.app$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Where Stripe sends the customer back. Production keeps the configured site origin.
 * A Vercel preview or localhost returns to itself. Any other host, including a forged
 * Host header, falls back to the configured origin, so this can never redirect off-site.
 */
export function checkoutOrigin(requestUrl: string | null | undefined, fallback: string): string {
  if (!requestUrl) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return fallback;
  }
  const host = parsed.hostname.toLowerCase();
  if (PROD_HOSTS.has(host)) return fallback;
  if (parsed.protocol === "https:" && !parsed.port && PREVIEW_HOST.test(host)) return `https://${host}`;
  if ((parsed.protocol === "http:" || parsed.protocol === "https:") && LOCAL_HOSTS.has(host)) return parsed.origin;
  return fallback;
}

/** Stripe sends the customer here. The token stays in the path, percent-encoded. */
export function checkoutReturnUrl(origin: string, token: string, result: "success" | "cancel"): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/order/${encodeURIComponent(token)}?checkout=${result}`;
}

/** Token from a Checkout success or cancel URL. Null when the path is not an order link. */
export function orderTokenFromReturnUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const match = /^\/order\/([^/]+)$/.exec(parsed.pathname);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Checkout can return before the webhook has recorded the order. Keep the page up and retry. */
export function waitsForCheckoutOrder(checkout: string | null | undefined): boolean {
  return checkout === "success" || checkout === "cancel";
}

/** How long to ask once a second after Stripe redirects back. Checks continue after this. */
export const CHECKOUT_ORDER_RETRY_MS = 12_000;

const CHECKOUT_ORDER_RETRY_DELAY_MS = 1_000;
const CHECKOUT_ORDER_RETRY_SLOW_MS = 5_000;

/** Delay before the next attempt. A late webhook still has a page to land on. */
export function checkoutOrderRetryDelay(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < CHECKOUT_ORDER_RETRY_MS) {
    return CHECKOUT_ORDER_RETRY_DELAY_MS;
  }
  return CHECKOUT_ORDER_RETRY_SLOW_MS;
}
