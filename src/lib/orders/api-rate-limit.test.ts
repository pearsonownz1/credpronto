import { beforeEach, describe, expect, it } from "vitest";
import { API_KEY_RATE_MAX, API_KEY_RATE_WINDOW_MS, consumeApiKeyRate, resetApiKeyRates } from "./api-rate-limit";
import { HttpError } from "./errors";
import { run } from "./http";

describe("API key rate limit", () => {
  beforeEach(() => {
    resetApiKeyRates();
  });

  it("allows 60 requests in a window and rejects the next one", () => {
    const now = Date.parse("2026-10-12T00:00:00.000Z");
    for (let i = 0; i < API_KEY_RATE_MAX; i += 1) {
      expect(consumeApiKeyRate("key-a", now).allowed).toBe(true);
    }
    const blocked = consumeApiKeyRate("key-a", now + 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(59);
    expect(consumeApiKeyRate("key-b", now).allowed).toBe(true);
  });

  it("starts a new window after 60 seconds", () => {
    const now = Date.parse("2026-10-12T00:00:00.000Z");
    for (let i = 0; i < API_KEY_RATE_MAX; i += 1) consumeApiKeyRate("key-a", now);
    expect(consumeApiKeyRate("key-a", now + API_KEY_RATE_WINDOW_MS).allowed).toBe(true);
  });

  it("returns Retry-After with the rate limit body", async () => {
    const response = await run(async () => {
      throw new HttpError("Too many requests", 429, "rate_limited", { retryAfterSeconds: 12 });
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(await response.json()).toEqual({
      error: "Too many requests",
      code: "rate_limited",
      retryAfterSeconds: 12,
    });
  });
});
