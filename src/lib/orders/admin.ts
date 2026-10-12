import { createClient } from "@/lib/supabase/server";
import {
  customerEmail,
  dismissCorrections,
  getDelivery,
  getOrderById,
  hasEvent,
  insertEvent,
  listConfirmations,
  listCorrections,
  listDocuments,
  listOrders,
  listPages,
  settledPayment,
  updateDelivery,
  updateOrder,
  withCombinedNumbers,
} from "./db";
import { sendDeliveryReady } from "./email";
import { HttpError } from "./errors";
import { normalizeLanguage } from "./languages";
import { etaFromNow } from "./quote";
import { serviceDb, type Db } from "./storage";
import { ORDER_STATUSES, type OrderStatus } from "./types";
import { translateOrder } from "./translation";

export async function requireStaff(): Promise<{ db: Db; userId: string; role: string }> {
  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    client = await createClient();
  } catch {
    throw new HttpError("Auth is not configured", 503);
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError("Sign in required", 401);

  const db = serviceDb();
  const staff = await db.from("staff").select("user_id, role").eq("user_id", data.user.id).maybeSingle();
  if (staff.error) throw new Error(staff.error.message);
  if (!staff.data) throw new HttpError("Staff access required", 403);

  return { db, userId: data.user.id, role: String(staff.data.role) };
}

export function parseStatus(value: string | null): OrderStatus | null {
  if (!value) return null;
  if ((ORDER_STATUSES as readonly string[]).includes(value)) return value as OrderStatus;
  throw new HttpError("Unknown status", 400);
}

export async function listStaffOrders(status: string | null) {
  const { db } = await requireStaff();
  return { orders: await listOrders(db, parseStatus(status)) };
}

export async function staffOrder(orderId: string) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const documents = await listDocuments(db, order.id);
  const pages = withCombinedNumbers(documents, await listPages(db, documents.map((document) => document.id)));
  const [confirmations, corrections, payment, delivery, email] = await Promise.all([
    listConfirmations(db, order.id),
    listCorrections(db, order.id),
    settledPayment(db, order.id),
    getDelivery(db, order.id),
    customerEmail(db, order.customerId),
  ]);

  return {
    ...order,
    email,
    documents: documents.map((document) => ({
      ...document,
      pages: pages.filter((page) => page.documentId === document.id),
    })),
    confirmations,
    corrections,
    payment,
    delivery,
  };
}

export async function approveOrder(orderId: string) {
  const { db, userId } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (order.status !== "paid" && order.status !== "approved") {
    throw new HttpError("Only a paid order can be certified", 409);
  }
  const payment = await settledPayment(db, order.id);
  if (!payment) throw new HttpError("Payment required", 402);
  const delivery = await getDelivery(db, order.id);
  if (!delivery) throw new HttpError("Payment has not created a delivery", 409);
  if (delivery.status === "delivered") return { status: "delivered" as const };
  if (!order.finalTranslationPath || !order.certificationPath) {
    throw new HttpError("Translated files are not ready", 409);
  }

  const now = new Date().toISOString();
  if (delivery.status !== "approved") {
    await updateDelivery(db, order.id, {
      status: "approved",
      approved_by: userId,
      approved_at: now,
      final_path: order.finalTranslationPath,
      certification_path: order.certificationPath,
    });
    await updateOrder(db, order.id, { status: "approved" });
  }

  const email = await customerEmail(db, order.customerId);
  const sent = email ? await sendDeliveryReady(email) : { sent: false, skipped: true };
  if (!sent.sent && !sent.skipped) {
    return { status: "approved" as const, email: "failed" as const };
  }

  await updateDelivery(db, order.id, {
    status: "delivered",
    delivered_at: new Date().toISOString(),
    approved_by: delivery.approvedBy ?? userId,
    approved_at: delivery.approvedAt ?? now,
    final_path: order.finalTranslationPath,
    certification_path: order.certificationPath,
  });
  await updateOrder(db, order.id, { status: "delivered" });
  return { status: "delivered" as const, email: sent.skipped ? "skipped" : "sent" };
}

export async function resolveReview(orderId: string, body: unknown) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  if (order.status !== "needs_review") throw new HttpError("This order is not waiting for review", 409);
  if (!order.billablePages || order.billablePages < 1 || order.totalCents == null) {
    throw new HttpError("There is no billable page count to quote", 409);
  }

  const requested =
    body && typeof body === "object" && typeof (body as { sourceLanguage?: unknown }).sourceLanguage === "string"
      ? (body as { sourceLanguage: string }).sourceLanguage
      : null;
  const language = requested ? normalizeLanguage(requested) : order.sourceLanguage;
  if (!language) throw new HttpError("Set a source language", 400);

  await updateOrder(db, order.id, {
    status: "quoted",
    source_language: language,
    review_reason: null,
    eta_at: etaFromNow(1),
  });
  if (!(await hasEvent(db, order.id, "quote_shown"))) {
    await insertEvent(db, order.id, "quote_shown", {
      billablePages: order.billablePages,
      totalCents: order.totalCents,
    });
  }
  return { status: "quoted" as const, sourceLanguage: language };
}

export async function resolveCorrections(orderId: string, body: unknown) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const action =
    body && typeof body === "object" && typeof (body as { action?: unknown }).action === "string"
      ? (body as { action: string }).action
      : "";
  const ids =
    body && typeof body === "object" && Array.isArray((body as { correctionIds?: unknown }).correctionIds)
      ? (body as { correctionIds: unknown[] }).correctionIds.filter((id): id is string => typeof id === "string")
      : [];

  if (action === "dismiss") {
    const open = (await listCorrections(db, order.id)).filter((correction) => correction.status === "open");
    const target = ids.length > 0 ? open.filter((correction) => ids.includes(correction.id)) : open;
    await dismissCorrections(db, target.map((correction) => correction.id));
    const remaining = (await listCorrections(db, order.id)).filter((correction) => correction.status === "open");
    if (remaining.length === 0 && order.status === "correction_requested") {
      await updateOrder(db, order.id, { status: "preview_ready" });
    }
    return { status: remaining.length === 0 ? "preview_ready" : order.status, dismissed: target.length };
  }

  if (action === "regenerate") {
    await translateOrder(db, order.id, null);
    const updated = await getOrderById(db, order.id);
    return { status: updated?.status ?? order.status };
  }

  throw new HttpError("action must be dismiss or regenerate", 400);
}
