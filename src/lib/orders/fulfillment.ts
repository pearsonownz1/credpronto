import { HttpError } from "./errors";
import type { ShippingAddress } from "./types";

export type MailTask = {
  status: "pending" | "shipped";
  trackingNumber: string | null;
  address: ShippingAddress | null;
};

export type NotarizationTask = {
  status: "pending" | "done";
};

export type OrderFulfillment = {
  mail: MailTask | null;
  notarization: NotarizationTask | null;
};

export function fulfillmentFor(order: {
  mailStatus: "pending" | "shipped" | null;
  mailTracking: string | null;
  shippingAddress: ShippingAddress | null;
  notarizationStatus: "pending" | "done" | null;
}): OrderFulfillment {
  return {
    mail: order.mailStatus
      ? {
          status: order.mailStatus,
          trackingNumber: order.mailTracking,
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

export function expeditedFirst<T extends { expedited: boolean; createdAt: string }>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    if (a.expedited !== b.expedited) return a.expedited ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
