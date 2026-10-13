import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  assertWebhookUrl,
  credProntoSignature,
  nextRetrySeconds,
  paidWebhookEvent,
  webhookBody,
  webhookReadBody,
} from "./outbound-webhook";

describe("outbound webhooks", () => {
  it("signs the raw body with the timestamp", () => {
    const body = webhookBody({
      id: "evt_1",
      type: "order.quoted",
      createdAt: "2026-10-12T00:00:00.000Z",
      orderId: "order-1",
      status: "quoted",
      externalRef: null,
    });
    const header = credProntoSignature("whsec_test", 1_700_000_000, body);
    const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
    expect(header).toBe(`t=1700000000,v1=${expected}`);
    expect(JSON.parse(body)).toMatchObject({
      type: "order.quoted",
      data: { orderId: "order-1", externalRef: null },
    });
  });

  it("signs a test event that has no order", () => {
    const body = webhookBody({
      id: "evt_test",
      type: "webhook.test",
      createdAt: "2026-10-12T00:00:00.000Z",
      orderId: null,
      status: "test",
      externalRef: null,
    });
    expect(JSON.parse(body)).toMatchObject({ type: "webhook.test", data: { orderId: null, status: "test" } });
    expect(JSON.parse(body)).not.toHaveProperty("secret");
  });

  it("retries after 60 seconds, then 5 minutes, then stops", () => {
    expect(nextRetrySeconds(1)).toBe(60);
    expect(nextRetrySeconds(2)).toBe(300);
    expect(nextRetrySeconds(3)).toBeNull();
  });

  it("returns the url, the secret's last 4, and the last delivery", () => {
    const body = webhookReadBody({
      url: "https://example.com/hooks",
      signingSecret: "whsec_abc123c0ff",
      lastDelivery: { status: "succeeded", event: "order.quoted", at: "2026-10-12T00:00:00.000Z", responseStatus: 200 },
    });
    expect(body).toEqual({
      url: "https://example.com/hooks",
      secretLast4: "c0ff",
      lastDelivery: { status: "succeeded", event: "order.quoted", at: "2026-10-12T00:00:00.000Z", responseStatus: 200 },
    });
    expect(body).not.toHaveProperty("secret");
    expect(JSON.stringify(body)).not.toContain("whsec_abc123c0ff");
    expect(webhookReadBody({ url: null, signingSecret: null, lastDelivery: null })).toEqual({
      url: null,
      secretLast4: null,
      lastDelivery: null,
    });
  });

  it("posts evaluation.paid for an evaluation and order.paid for a translation", () => {
    expect(paidWebhookEvent({ serviceType: "evaluation", orderType: "evaluation" })).toBe("evaluation.paid");
    expect(paidWebhookEvent({ serviceType: "evaluation" })).toBe("evaluation.paid");
    expect(paidWebhookEvent({ orderType: "evaluation" })).toBe("evaluation.paid");
    expect(paidWebhookEvent({ serviceType: "translation", orderType: "translation" })).toBe("order.paid");
    expect(paidWebhookEvent(null)).toBe("order.paid");
    const body = webhookBody({
      id: "evt_eval",
      type: "evaluation.paid",
      createdAt: "2026-10-13T00:00:00.000Z",
      orderId: "order-1",
      status: "needs_review",
      externalRef: "crm-1842",
    });
    expect(JSON.parse(body)).toMatchObject({
      type: "evaluation.paid",
      data: { orderId: "order-1", status: "needs_review", externalRef: "crm-1842" },
    });
  });

  it("accepts only https urls", () => {
    expect(assertWebhookUrl("https://example.com/hooks/credpronto")).toBe(
      "https://example.com/hooks/credpronto",
    );
    expect(() => assertWebhookUrl("http://example.com/hooks")).toThrowError(HttpError);
    try {
      assertWebhookUrl("notaurl");
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: "validation_error" });
    }
  });
});
