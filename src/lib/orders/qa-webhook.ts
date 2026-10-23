import { resolveServices } from "./service-selection";
import { waitUntil as defaultWaitUntil } from "./staff-alert-schedule";
import type { OrderRecord } from "./types";

/** Caps the QA wake-up post so a slow receiver cannot hold anything. */
export const QA_WEBHOOK_TIMEOUT_MS = 5_000;

export type QaReviewPing = {
  event: "order.paid_review";
  orderId: string;
  orderType: string | null;
  services: string[];
};

type QaOrder = Pick<OrderRecord, "id" | "orderType" | "service" | "services" | "includeTranslation">;

export function qaReviewPing(order: QaOrder): QaReviewPing {
  return {
    event: "order.paid_review",
    orderId: order.id,
    orderType: order.orderType ?? null,
    services: [...resolveServices(order)],
  };
}

/** Posts the ping. Never throws; failures are logged without secrets. */
export async function postQaReviewPing(order: QaOrder): Promise<void> {
  const url = process.env.QA_WEBHOOK_URL?.trim();
  const key = process.env.QA_WEBHOOK_KEY?.trim();
  if (!url || !key) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(qaReviewPing(order)),
      signal: AbortSignal.timeout(QA_WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[qa-webhook] order ${order.id}: HTTP ${res.status}`);
  } catch (error) {
    const name = error instanceof Error ? error.name : "error";
    console.warn(`[qa-webhook] order ${order.id}: ${name}`);
  }
}

/** Fire-and-forget wake-up for QA. Never blocks or fails payment handling. */
export function notifyQaReview(
  order: QaOrder,
  hold: (task: Promise<unknown>) => void = defaultWaitUntil,
): void {
  if (!process.env.QA_WEBHOOK_URL?.trim() || !process.env.QA_WEBHOOK_KEY?.trim()) return;
  const task = postQaReviewPing(order);
  try {
    hold(task);
  } catch {
    // Outside a request scope (cron, tests) `after` throws; the promise still runs.
  }
}
