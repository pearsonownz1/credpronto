import { readyPreviewPath } from "@/lib/flow/present";
import { fulfillmentState } from "./release-decision";
import { orderForToken } from "./order-access";

function flowMock(): boolean {
  return process.env.NEXT_PUBLIC_FLOW_MOCK === "1" || process.env.CREDPRONTO_MOCK === "1";
}

const PAID_ORDER = new Set(["paid", "approved", "delivered"]);

/** A paid order leaves the Buy & download preview for the order page. */
export function paidOrderPath(token: string, status: string | null | undefined): string | null {
  if (!token || !status || !PAID_ORDER.has(status)) return null;
  return `/order/${encodeURIComponent(token)}`;
}

/** `/preview/:id` for an order that has already been paid. */
export async function paidOrderDestination(token: string): Promise<string | null> {
  if (!token || flowMock()) return null;
  try {
    const { order } = await orderForToken(token);
    return paidOrderPath(token, order.status);
  } catch {
    return null;
  }
}

/**
 * Where `/order/[token]` should send a customer whose preview already exists.
 * Checkout returns stay on this route. Mock orders live in the browser, so the
 * processing screen redirects those itself.
 */
export async function readyPreviewDestination(
  token: string,
  checkout: string | null | undefined,
): Promise<string | null> {
  if (!token || flowMock()) return null;
  if (checkout === "success" || checkout === "cancel") return null;
  try {
    const { order } = await orderForToken(token);
    return readyPreviewPath(token, checkout, {
      status: order.status,
      progress: order.progress,
      reviewReason: order.reviewReason,
      orderType: order.orderType,
      service: order.service,
      serviceType: order.serviceType,
      includeTranslation: order.includeTranslation,
      fulfillment: fulfillmentState(order),
    });
  } catch {
    return null;
  }
}
