import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WEBHOOK_TIMEOUT_MS, postSignedWebhook } from "./webhook-delivery";

const endpoint = {
  id: "ep-1",
  userId: "user-1",
  url: "https://example.com/hooks",
  signingSecret: "whsec_test",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signed webhook posts", () => {
  it("signs the raw body and uses a short timeout", async () => {
    const body = JSON.stringify({ type: "order.paid" });
    let signal: AbortSignal | null = null;
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? null;
      const header = new Headers(init?.headers).get("CredPronto-Signature") ?? "";
      const match = header.match(/^t=(\d+),v1=([0-9a-f]+)$/);
      expect(match).not.toBeNull();
      const mac = createHmac("sha256", endpoint.signingSecret).update(`${match?.[1]}.${body}`).digest("hex");
      expect(header).toBe(`t=${match?.[1]},v1=${mac}`);
      return new Response(null, { status: 204 });
    });

    await expect(postSignedWebhook(endpoint, body, WEBHOOK_TIMEOUT_MS)).resolves.toEqual({ ok: true, status: 204 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(WEBHOOK_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it("records a network failure as an attempt with no status", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("timed out");
    });
    await expect(postSignedWebhook(endpoint, "{}", WEBHOOK_TIMEOUT_MS)).resolves.toEqual({ ok: false, status: null });
  });
});
