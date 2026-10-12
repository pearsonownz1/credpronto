import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INTEGRATION_ROUTES,
  createLiveIntegrationsClient,
  isUnavailableStatus,
  parseApiKeys,
  parseApiOrders,
  parseBillingCard,
  parseCreatedKey,
  parseSavedWebhook,
  parseSetupIntent,
  parseTestDelivery,
  parseWebhookEndpoint,
  toSection,
} from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("integrations API parsing", () => {
  it("reads keys, an empty card, and a saved visa", () => {
    expect(
      parseApiKeys({
        keys: [
          {
            id: "key_1",
            name: "Production",
            prefix: "cp_test_",
            last4: "a91f",
            createdAt: "2026-10-11T15:04:00.000Z",
            revokedAt: null,
          },
        ],
      })?.[0],
    ).toMatchObject({ prefix: "cp_test_", last4: "a91f", revokedAt: null, lastUsedKnown: false, lastUsedAt: null });
    expect(
      parseApiKeys({
        keys: [
          {
            id: "key_1",
            name: "Production",
            prefix: "cp_live_",
            last4: "ab12",
            createdAt: "2026-10-11T15:04:00.000Z",
            lastUsedAt: "2026-10-12T01:00:00.000Z",
            revokedAt: null,
          },
        ],
      })?.[0],
    ).toMatchObject({ lastUsedKnown: true, lastUsedAt: "2026-10-12T01:00:00.000Z" });
    expect(parseApiKeys({ keys: [] })).toEqual([]);
    expect(parseBillingCard({ card: null })).toEqual({ card: null });
    expect(parseBillingCard({ card: { brand: "visa", last4: "4242" } })).toEqual({
      card: { brand: "visa", last4: "4242", expMonth: null, expYear: null },
    });
    expect(parseBillingCard({ card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2028 } })).toEqual({
      card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2028 },
    });
    expect(parseCreatedKey({
      id: "key_1",
      name: "Production",
      prefix: "cp_live_",
      last4: "a91f",
      secret: "cp_live_abc",
      createdAt: "2026-10-11T15:04:00.000Z",
    })?.secret).toBe("cp_live_abc");
    expect(parseSavedWebhook({ url: "https://example.com/hooks", secret: "whsec_abc" })).toEqual({
      url: "https://example.com/hooks",
      secret: "whsec_abc",
    });
    expect(parseSetupIntent({ clientSecret: "seti_secret", customerId: "cus_123" })).toEqual({
      clientSecret: "seti_secret",
      customerId: "cus_123",
    });
  });

  it("reads a webhook endpoint and api orders without inventing amounts", () => {
    expect(parseWebhookEndpoint({ url: null, secretLast4: null, lastDelivery: null })).toEqual({ endpoint: null });
    expect(
      parseWebhookEndpoint({
        url: "https://example.com/hooks",
        secretLast4: "c0ff",
        lastDelivery: { status: "succeeded", event: "order.quoted", at: "2026-10-12T00:00:00.000Z", responseStatus: 200 },
      })?.endpoint,
    ).toMatchObject({ url: "https://example.com/hooks", secret: null, lastDelivery: { status: "succeeded" } });
    expect(parseTestDelivery({ status: "failed", event: "order.quoted", at: "2026-10-12T00:00:00.000Z", responseStatus: 500 })?.status).toBe(
      "failed",
    );
    expect(
      parseApiOrders({
        orders: [
          {
            id: "ord_1",
            externalRef: "crm-1842",
            keyName: "Production",
            keyPrefix: "cp_live_",
            keyLast4: "ab12",
            pages: 3,
            status: "paid",
            amountCents: null,
            currency: "usd",
            placedAt: "2026-10-12T00:00:00.000Z",
            downloadUrl: null,
            viewUrl: "/order/tok",
          },
        ],
      })?.[0],
    ).toMatchObject({ amountCents: null, pages: 3, externalRef: "crm-1842" });
    expect(parseApiOrders({ orders: [{ id: "ord_1" }] })).toBeNull();
    expect(parseApiKeys(null)).toBeNull();
  });

  it("treats a missing route as unavailable and a real failure as an error", () => {
    expect(isUnavailableStatus(404)).toBe(true);
    expect(isUnavailableStatus(405)).toBe(true);
    expect(toSection({ ok: false, status: 405, error: "Request failed" }, true)).toEqual({ status: "unavailable" });
    expect(toSection({ ok: false, status: 500, error: "Request failed" }, true)).toEqual({
      status: "error",
      message: "Request failed",
    });
    expect(toSection({ ok: true, status: 200, data: [] }, false)).toEqual({ status: "ready", data: [] });
  });

  it("calls the documented key, webhook, and billing routes", async () => {
    const calls: string[] = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.endsWith(INTEGRATION_ROUTES.keys) && method === "GET") {
        return json({ keys: [] });
      }
      if (url.endsWith(INTEGRATION_ROUTES.billing) && method === "GET") {
        return json({ card: { brand: "visa", last4: "4242" } });
      }
      if (url.endsWith(INTEGRATION_ROUTES.webhook) && method === "GET") {
        return json({ error: "missing" }, 405);
      }
      if (url.endsWith(INTEGRATION_ROUTES.apiOrders) && method === "GET") {
        return json({ error: "missing" }, 404);
      }
      if (url.endsWith(INTEGRATION_ROUTES.keys) && method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ name: "Production", mode: "test" }));
        return json(
          {
            id: "key_1",
            name: "Production",
            prefix: "cp_test_",
            last4: "abcd",
            secret: "cp_test_abcd",
            createdAt: "2026-10-12T00:00:00.000Z",
          },
          201,
        );
      }
      if (url.endsWith(INTEGRATION_ROUTES.webhook) && method === "PUT") {
        return json({ url: "https://example.com/hooks", secret: "whsec_once" });
      }
      if (url.endsWith(INTEGRATION_ROUTES.webhookTest) && method === "POST") {
        return json({ error: "missing" }, 404);
      }
      if (url.endsWith(INTEGRATION_ROUTES.setupIntent) && method === "POST") {
        return json({ clientSecret: "seti_secret", customerId: "cus_123" });
      }
      if (url.endsWith(INTEGRATION_ROUTES.billing) && method === "DELETE") {
        return json({ card: null });
      }
      return json({ error: "missing" }, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createLiveIntegrationsClient();
    const loaded = await client.load();
    expect(loaded.ok && loaded.data.card).toEqual({
      status: "ready",
      data: { brand: "visa", last4: "4242", expMonth: null, expYear: null },
    });
    expect(loaded.ok && loaded.data.keys).toEqual({ status: "ready", data: [] });
    expect(loaded.ok && loaded.data.webhook).toEqual({ status: "unavailable" });
    expect(loaded.ok && loaded.data.apiOrders).toEqual({ status: "unavailable" });
    const created = await client.createKey({ name: "Production", mode: "test" });
    expect(created.ok && created.data.secret).toBe("cp_test_abcd");
    const webhook = await client.saveWebhook("https://example.com/hooks");
    expect(webhook.ok && webhook.data.secret).toBe("whsec_once");
    const test = await client.sendTest();
    expect(test.ok).toBe(false);
    if (!test.ok) expect(test.status).toBe(404);
    const intent = await client.createSetupIntent();
    expect(intent.ok && intent.data.clientSecret).toBe("seti_secret");
    const removed = await client.removeCard();
    expect(removed.ok && removed.data.card).toBeNull();
    expect(calls.some((call) => call.startsWith("GET") && call.endsWith(INTEGRATION_ROUTES.apiOrders))).toBe(true);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
