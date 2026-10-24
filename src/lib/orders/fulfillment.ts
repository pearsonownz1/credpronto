import { HttpError } from "./errors";
import type { NotarizationStatus, ShippingAddress } from "./types";

export type MailTask = {
  status: "pending" | "shipped";
  trackingNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  address: ShippingAddress | null;
};

export type NotarizationTask = {
  status: NotarizationStatus;
};

export type OrderFulfillment = {
  mail: MailTask | null;
  notarization: NotarizationTask | null;
};

export function fulfillmentFor(order: {
  mailStatus: "pending" | "shipped" | null;
  mailTracking: string | null;
  mailCarrier?: string | null;
  mailShippedAt?: string | null;
  shippingAddress: ShippingAddress | null;
  notarizationStatus: NotarizationStatus | null;
}): OrderFulfillment {
  return {
    mail: order.mailStatus
      ? {
          status: order.mailStatus,
          trackingNumber: order.mailTracking,
          carrier: order.mailCarrier ?? null,
          shippedAt: order.mailShippedAt ?? null,
          address: order.shippingAddress,
        }
      : null,
    notarization: order.notarizationStatus ? { status: order.notarizationStatus } : null,
  };
}

export function parseTrackingNumber(body: unknown): string {
  const record =
    body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const tracking = typeof record.trackingNumber === "string" ? record.trackingNumber.trim() : "";
  if (!tracking || tracking.length > 80) throw new HttpError("Tracking number is required", 400);
  return tracking;
}

/**
 * Oldest paid_at first. Unpaid orders follow. Expedited wins only when paid_at ties.
 * A missing paid_at keeps the previous expedited-then-newest order.
 */
export function staffQueueOrder<T extends { expedited: boolean; createdAt: string; paidAt?: string | null }>(
  orders: T[],
): T[] {
  return [...orders].sort((a, b) => {
    const aPaid = a.paidAt || null;
    const bPaid = b.paidAt || null;
    if (aPaid && bPaid && aPaid !== bPaid) return aPaid < bPaid ? -1 : 1;
    if (Boolean(aPaid) !== Boolean(bPaid)) return aPaid ? -1 : 1;
    if (a.expedited !== b.expedited) return a.expedited ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function expeditedFirst<T extends { expedited: boolean; createdAt: string; paidAt?: string | null }>(
  orders: T[],
): T[] {
  return staffQueueOrder(orders);
}
