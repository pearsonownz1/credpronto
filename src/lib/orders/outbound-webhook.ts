import { createHmac, randomBytes } from "node:crypto";
import { HttpError } from "./errors";

export const WEBHOOK_EVENTS = ["order.quoted", "order.delivered", "order.failed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

export function assertWebhookUrl(value: unknown): string {
  if (typeof value !== "string") throw new HttpError("Webhook URL must be https", 400, "validation_error");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError("Webhook URL must be https", 400, "validation_error");
  }
  if (url.protocol !== "https:") throw new HttpError("Webhook URL must be https", 400, "validation_error");
  return url.toString();
}

export function webhookBody(input: {
  id: string;
  type: WebhookEvent;
  createdAt: string;
  orderId: string;
  status: string;
  externalRef: string | null;
}): string {
  return JSON.stringify({
    id: input.id,
    type: input.type,
    createdAt: input.createdAt,
    data: {
      orderId: input.orderId,
      status: input.status,
      externalRef: input.externalRef,
    },
  });
}

/** `t=<unix>,v1=<hex hmac-sha256 of `${t}.${rawBody}`>`. */
export function credProntoSignature(secret: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

/** Seconds until the next attempt after a failure. Attempt 3 is the last. */
export function nextRetrySeconds(attempt: number): number | null {
  if (attempt <= 1) return 60;
  if (attempt === 2) return 300;
  return null;
}

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}
