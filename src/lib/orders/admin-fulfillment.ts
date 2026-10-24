import { parseShippingAddress } from "./addons";
import { getOrderById, listOrderAddons, updateOrder } from "./db";
import { HttpError } from "./errors";
import { requireStaff } from "./staff";
import type { NotarizationStatus, OrderRecord, ShippingAddress } from "./types";

const NOTARIZATION_STATUSES = new Set<NotarizationStatus>(["pending", "notarized", "done"]);
const CARRIER_MAX = 40;
const TRACKING_MAX = 80;

export function orderNeedsNotarization(
  order: Pick<OrderRecord, "notarizationStatus">,
  addons: readonly { id: string }[],
): boolean {
  return order.notarizationStatus != null || addons.some((addon) => addon.id === "notarization");
}

export function orderNeedsMail(
  order: Pick<OrderRecord, "mailStatus">,
  addons: readonly { id: string }[],
): boolean {
  return order.mailStatus != null || addons.some((addon) => addon.id === "mail");
}

export function parseNotarizationStatus(body: unknown): NotarizationStatus {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("Expected a JSON body", 400);
  const status = (body as { status?: unknown }).status;
  if (typeof status !== "string" || !NOTARIZATION_STATUSES.has(status as NotarizationStatus)) {
    throw new HttpError("status must be pending, notarized, or done", 400);
  }
  return status as NotarizationStatus;
}

export type MailUpdate = {
  address?: ShippingAddress;
  carrier?: string | null;
  trackingNumber?: string | null;
  shipped?: boolean;
  shippedAt?: string | null;
};

function optionalCarrier(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new HttpError("carrier must be a string or null", 400);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CARRIER_MAX || /[\r\n]/.test(trimmed)) {
    throw new HttpError("carrier must be 40 characters or fewer", 400);
  }
  return trimmed;
}

function optionalTracking(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new HttpError("trackingNumber must be a string or null", 400);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > TRACKING_MAX) throw new HttpError("trackingNumber must be 80 characters or fewer", 400);
  return trimmed;
}

function optionalTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HttpError("shippedAt must be an ISO timestamp or null", 400);
  }
  return new Date(value).toISOString();
}

export function parseMailUpdate(body: unknown): MailUpdate {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("Expected a JSON body", 400);
  const record = body as Record<string, unknown>;
  const update: MailUpdate = {};
  if ("address" in record) update.address = parseShippingAddress(record.address);
  if ("carrier" in record) update.carrier = optionalCarrier(record.carrier);
  if ("trackingNumber" in record) update.trackingNumber = optionalTracking(record.trackingNumber);
  if ("shipped" in record) {
    if (typeof record.shipped !== "boolean") throw new HttpError("shipped must be true or false", 400);
    update.shipped = record.shipped;
  }
  if ("shippedAt" in record) update.shippedAt = optionalTimestamp(record.shippedAt);
  if (
    update.address === undefined &&
    update.carrier === undefined &&
    update.trackingNumber === undefined &&
    update.shipped === undefined &&
    update.shippedAt === undefined
  ) {
    throw new HttpError("Nothing to update", 400);
  }
  if (update.shipped === false && update.shippedAt) {
    throw new HttpError("shippedAt cannot be set when shipped is false", 400);
  }
  if (update.shipped !== true && update.shippedAt) {
    throw new HttpError("shippedAt requires shipped", 400);
  }
  return update;
}

function mailingBody(order: OrderRecord, needed: boolean) {
  return {
    needed,
    address: order.shippingAddress,
    carrier: order.mailCarrier ?? null,
    trackingNumber: order.mailTracking,
    shipped: order.mailStatus === "shipped",
    shippedAt: order.mailShippedAt ?? null,
  };
}

function notarizationBody(order: OrderRecord, needed: boolean) {
  return { needed, status: needed ? order.notarizationStatus : null };
}

async function staffOrder(orderId: string) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const addons = await listOrderAddons(db, order.id);
  return { db, order, addons };
}

export async function readNotarization(orderId: string) {
  const { order, addons } = await staffOrder(orderId);
  return notarizationBody(order, orderNeedsNotarization(order, addons));
}

export async function updateNotarization(orderId: string, body: unknown) {
  const status = parseNotarizationStatus(body);
  const { db, order, addons } = await staffOrder(orderId);
  if (!orderNeedsNotarization(order, addons)) throw new HttpError("This order has no notarization add-on", 409);
  if (order.notarizationStatus !== status) {
    await updateOrder(db, order.id, { notarization_status: status });
  }
  return { needed: true as const, status };
}

export async function readMailing(orderId: string) {
  const { order, addons } = await staffOrder(orderId);
  return mailingBody(order, orderNeedsMail(order, addons));
}

export async function updateMailing(orderId: string, body: unknown) {
  const update = parseMailUpdate(body);
  const { db, order, addons } = await staffOrder(orderId);
  if (!orderNeedsMail(order, addons)) throw new HttpError("This order has no mail add-on", 409);

  const patch: Record<string, unknown> = {};
  if (update.address) {
    patch.shipping_name = update.address.name;
    patch.shipping_line1 = update.address.line1;
    patch.shipping_line2 = update.address.line2;
    patch.shipping_city = update.address.city;
    patch.shipping_state = update.address.state;
    patch.shipping_postal_code = update.address.postalCode;
    patch.shipping_country = update.address.country;
  }
  if (update.carrier !== undefined) patch.mail_carrier = update.carrier;
  if (update.trackingNumber !== undefined) patch.mail_tracking = update.trackingNumber;

  if (update.shipped === true) {
    patch.mail_status = "shipped";
    patch.mail_shipped_at = update.shippedAt ?? order.mailShippedAt ?? new Date().toISOString();
  } else if (update.shipped === false) {
    patch.mail_status = "pending";
    patch.mail_shipped_at = null;
  }

  if (Object.keys(patch).length > 0) await updateOrder(db, order.id, patch);

  const next = await getOrderById(db, order.id);
  if (!next) throw new HttpError("Order not found", 404);
  return mailingBody(next, true);
}
