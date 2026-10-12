import { randomUUID } from "node:crypto";
import type { Db } from "./storage";
import { getOrderById } from "./db";
import {
  dueWebhookDeliveries,
  finishWebhookDelivery,
  insertWebhookDelivery,
  webhookEndpointForUser,
  type WebhookEndpointRow,
} from "./integrations-db";
import { HttpError } from "./errors";
import {
  credProntoSignature,
  nextRetrySeconds,
  webhookBody,
  type LifecycleWebhookEvent,
  type WebhookEvent,
  type WebhookLastDelivery,
} from "./outbound-webhook";

export const WEBHOOK_TIMEOUT_MS = 5_000;

type Attempt = { ok: boolean; status: number | null };

export async function postSignedWebhook(
  endpoint: WebhookEndpointRow,
  body: string,
  timeoutMs?: number,
): Promise<Attempt> {
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CredPronto-Signature": credProntoSignature(endpoint.signingSecret, timestamp, body),
      },
      body,
      signal: timeoutMs == null ? undefined : AbortSignal.timeout(timeoutMs),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

function retryAt(attempt: number): string | null {
  const seconds = nextRetrySeconds(attempt);
  if (seconds == null) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function sendBody(
  db: Db,
  endpoint: WebhookEndpointRow,
  orderId: string,
  event: WebhookEvent,
  body: string,
  attempt: number,
  existingId: string | null,
): Promise<void> {
  const result = await postSignedWebhook(endpoint, body);
  const status = result.ok ? "succeeded" : nextRetrySeconds(attempt) == null ? "failed" : "pending";
  const nextRetryAt = result.ok ? null : retryAt(attempt);
  if (existingId) {
    await finishWebhookDelivery(db, existingId, {
      status,
      responseStatus: result.status,
      nextRetryAt,
      attempt,
    });
    return;
  }
  await insertWebhookDelivery(db, {
    endpointId: endpoint.id,
    orderId,
    event,
    attempt,
    status,
    responseStatus: result.status,
    nextRetryAt,
  });
}

export async function retryDueWebhooks(db: Db): Promise<void> {
  const due = await dueWebhookDeliveries(db, 5);
  for (const row of due) {
    const order = await getOrderById(db, row.orderId);
    if (!order?.userId) {
      await finishWebhookDelivery(db, row.id, {
        status: "failed",
        responseStatus: row.responseStatus,
        nextRetryAt: null,
        attempt: row.attempt,
      });
      continue;
    }
    const endpoint = await webhookEndpointForUser(db, order.userId);
    if (!endpoint || endpoint.id !== row.endpointId) {
      await finishWebhookDelivery(db, row.id, {
        status: "failed",
        responseStatus: null,
        nextRetryAt: null,
        attempt: row.attempt,
      });
      continue;
    }
    const nextAttempt = row.attempt + 1;
    const body = webhookBody({
      id: `evt_${randomUUID()}`,
      type: row.event,
      createdAt: new Date().toISOString(),
      orderId: order.id,
      status: order.status,
      externalRef: order.externalRef,
    });
    await sendBody(db, endpoint, order.id, row.event, body, nextAttempt, row.id);
  }
}

/** One signed POST with a short timeout. The last result is stored. Failures stay in the caller. */
export async function notifyLifecycle(db: Db, orderId: string, event: LifecycleWebhookEvent): Promise<void> {
  try {
    const order = await getOrderById(db, orderId);
    if (!order?.userId) return;
    const endpoint = await webhookEndpointForUser(db, order.userId);
    if (!endpoint) return;
    const createdAt = new Date().toISOString();
    const body = webhookBody({
      id: `evt_${randomUUID()}`,
      type: event,
      createdAt,
      orderId: order.id,
      status: order.status,
      externalRef: order.externalRef,
    });
    const result = await postSignedWebhook(endpoint, body, WEBHOOK_TIMEOUT_MS);
    await insertWebhookDelivery(db, {
      endpointId: endpoint.id,
      orderId: order.id,
      event,
      attempt: 1,
      status: result.ok ? "succeeded" : "failed",
      responseStatus: result.status,
      nextRetryAt: null,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "webhook delivery failed");
  }
}

/** Signed test ping to the saved URL. The full secret is not returned. */
export async function sendTestWebhook(db: Db, userId: string): Promise<WebhookLastDelivery> {
  const endpoint = await webhookEndpointForUser(db, userId);
  if (!endpoint) throw new HttpError("Save a webhook URL first", 404, "not_found");
  const createdAt = new Date().toISOString();
  const body = webhookBody({
    id: `evt_${randomUUID()}`,
    type: "webhook.test",
    createdAt,
    orderId: null,
    status: "test",
    externalRef: null,
  });
  const result = await postSignedWebhook(endpoint, body, WEBHOOK_TIMEOUT_MS);
  const delivery: WebhookLastDelivery = {
    status: result.ok ? "succeeded" : "failed",
    event: "webhook.test",
    at: createdAt,
    responseStatus: result.status,
  };
  await insertWebhookDelivery(db, {
    endpointId: endpoint.id,
    orderId: null,
    event: "webhook.test",
    attempt: 1,
    status: result.ok ? "succeeded" : "failed",
    responseStatus: result.status,
    nextRetryAt: null,
  });
  return delivery;
}

export async function notifyOrder(db: Db, orderId: string, event: WebhookEvent): Promise<void> {
  try {
    await retryDueWebhooks(db);
    const order = await getOrderById(db, orderId);
    if (!order?.userId) return;
    const endpoint = await webhookEndpointForUser(db, order.userId);
    if (!endpoint) return;
    const body = webhookBody({
      id: `evt_${randomUUID()}`,
      type: event,
      createdAt: new Date().toISOString(),
      orderId: order.id,
      status: order.status,
      externalRef: order.externalRef,
    });
    await sendBody(db, endpoint, order.id, event, body, 1, null);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "webhook delivery failed");
  }
}
