import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLiveIntegrationsClient,
  parseApiKeys,
  parseBillingCard,
  parseCreatedKey,
  parseSavedWebhook,
  parseSetupIntent,
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
    ).toMatchObject({ prefix: "cp_test_", last4: "a91f", revokedAt: null });
    expect(parseBillingCard({ card: null })).toEqual({ card: null });
    expect(parseBillingCard({ card: { brand: "visa", last4: "4242" } })).toEqual({
      card: { brand: "visa", last4: "4242" },
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

  it("calls the documented key, webhook, and billing routes", async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/me/api-keys") && method === "GET") {
        return json({ keys: [] });
      }
      if (url.endsWith("/api/me/billing") && method === "GET") {
        return json({ card: { brand: "visa", last4: "4242" } });
      }
      if (url.endsWith("/api/me/api-keys") && method === "POST") {
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
      if (url.endsWith("/api/me/webhook") && method === "PUT") {
        return json({ url: "https://example.com/hooks", secret: "whsec_once" });
      }
      if (url.endsWith("/api/me/billing/setup-intent") && method === "POST") {
        return json({ clientSecret: "seti_secret", customerId: "cus_123" });
      }
      if (url.endsWith("/api/me/billing") && method === "DELETE") {
        return json({ card: null });
      }
      return json({ error: "missing" }, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createLiveIntegrationsClient();
    const loaded = await client.load();
    expect(loaded.ok && loaded.data.card).toEqual({ brand: "visa", last4: "4242" });
    const created = await client.createKey({ name: "Production", mode: "test" });
    expect(created.ok && created.data.secret).toBe("cp_test_abcd");
    const webhook = await client.saveWebhook("https://example.com/hooks");
    expect(webhook.ok && webhook.data.secret).toBe("whsec_once");
    const intent = await client.createSetupIntent();
    expect(intent.ok && intent.data.clientSecret).toBe("seti_secret");
    const removed = await client.removeCard();
    expect(removed.ok && removed.data.card).toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
