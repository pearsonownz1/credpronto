import { createHmac } from "node:crypto";
import type { EvaluationService } from "./types";

/** Header on the staff alert. HMAC-SHA256 hex of the raw JSON body. */
export const EVAL_ALERT_SIGNATURE_HEADER = "X-CredPronto-Signature";

/** Caps the post so a slow receiver cannot hold payment settlement. */
export const EVAL_ALERT_TIMEOUT_MS = 3_000;

export type EvaluationPaidAlert = {
  orderId: string;
  type: EvaluationService;
  customerEmail: string | null;
  paidAt: string;
  adminUrl: string;
};

export function evaluationPaidAlertBody(input: EvaluationPaidAlert): string {
  return JSON.stringify({
    event: "evaluation.paid",
    orderId: input.orderId,
    type: input.type,
    customerEmail: input.customerEmail,
    paidAt: input.paidAt,
    adminUrl: input.adminUrl,
  });
}

/** Hex HMAC-SHA256 of the exact bytes that are posted. */
export function evalAlertSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Posts the paid-evaluation staff alert. Unset URL skips the call.
 * Network and timeout errors are swallowed so payment can finish.
 */
export async function postEvaluationPaidAlert(input: EvaluationPaidAlert): Promise<void> {
  const url = process.env.EVAL_ALERT_WEBHOOK_URL?.trim();
  if (!url) return;
  const secret = process.env.EVAL_ALERT_WEBHOOK_SECRET ?? "";
  const body = evaluationPaidAlertBody(input);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [EVAL_ALERT_SIGNATURE_HEADER]: evalAlertSignature(secret, body),
      },
      body,
      signal: AbortSignal.timeout(EVAL_ALERT_TIMEOUT_MS),
    });
  } catch {
    // The order is already paid. A missed alert must not fail checkout.
  }
}
