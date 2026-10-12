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

/** How long to keep asking for the order after Stripe redirects back. */
export const CHECKOUT_ORDER_RETRY_MS = 12_000;

const CHECKOUT_ORDER_RETRY_DELAY_MS = 1_000;

/** Delay before the next attempt, or null once the wait is over. */
export function checkoutOrderRetryDelay(elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs >= CHECKOUT_ORDER_RETRY_MS) return null;
  return CHECKOUT_ORDER_RETRY_DELAY_MS;
}
