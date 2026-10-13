import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVAL_ALERT_SIGNATURE_HEADER,
  EVAL_ALERT_TIMEOUT_MS,
  evalAlertSignature,
  postEvaluationPaidAlert,
  type EvaluationPaidAlert,
} from "./eval-alert-webhook";

const alert: EvaluationPaidAlert = {
  orderId: "order-9",
  type: "diploma",
  customerEmail: "ada@example.com",
  paidAt: "2026-10-12T00:05:00.000Z",
  adminUrl: "https://credpronto.com/admin/orders/order-9",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EVAL_ALERT_WEBHOOK_URL;
  delete process.env.EVAL_ALERT_WEBHOOK_SECRET;
});

describe("evaluation paid staff alert", () => {
  it("signs the raw body with hmac-sha256", () => {
    const body = JSON.stringify({ event: "evaluation.paid", orderId: "order-9" });
    const secret = "test-secret";
    expect(evalAlertSignature(secret, body)).toBe(createHmac("sha256", secret).update(body).digest("hex"));
    expect(EVAL_ALERT_SIGNATURE_HEADER).toBe("X-CredPronto-Signature");
    expect(EVAL_ALERT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it("skips the post when the webhook url is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await postEvaluationPaidAlert(alert);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the signed json with a short timeout", async () => {
    process.env.EVAL_ALERT_WEBHOOK_URL = "https://alerts.example/paid";
    process.env.EVAL_ALERT_WEBHOOK_SECRET = "test-secret";
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await postEvaluationPaidAlert(alert);

    const raw = JSON.stringify({
      event: "evaluation.paid",
      orderId: alert.orderId,
      type: alert.type,
      customerEmail: alert.customerEmail,
      paidAt: alert.paidAt,
      adminUrl: alert.adminUrl,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://alerts.example/paid", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-CredPronto-Signature": createHmac("sha256", "test-secret").update(raw).digest("hex"),
      },
      body: raw,
      signal: expect.any(AbortSignal),
    });
    expect(timeout).toHaveBeenCalledWith(EVAL_ALERT_TIMEOUT_MS);
  });

  it("swallows a network failure", async () => {
    process.env.EVAL_ALERT_WEBHOOK_URL = "https://alerts.example/paid";
    process.env.EVAL_ALERT_WEBHOOK_SECRET = "test-secret";
    vi.stubGlobal("fetch", async () => {
      throw new Error("timed out");
    });
    await expect(postEvaluationPaidAlert(alert)).resolves.toBeUndefined();
  });

  it("claims the send once in the orders table", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261013120000_eval_paid_alert.sql"),
      "utf8",
    );
    expect(sql).toMatch(/add column if not exists eval_paid_alert_sent_at timestamptz/);
  });
});
