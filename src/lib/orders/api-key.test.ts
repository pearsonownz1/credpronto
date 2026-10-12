import { describe, expect, it } from "vitest";
import { bearerApiKey, generateApiKey, hashApiKey, liveOrderPostBlocked, parseApiKeyMode, parseApiKeyName, publicApiKey } from "./api-key";
import { HttpError } from "./errors";

describe("API keys", () => {
  it("shows a prefixed secret once and stores only its sha256", () => {
    const live = generateApiKey("live");
    const test = generateApiKey("test");
    expect(live.secret.startsWith("cp_live_")).toBe(true);
    expect(test.secret.startsWith("cp_test_")).toBe(true);
    expect(live.secret.slice("cp_live_".length)).toMatch(/^[0-9a-f]{64}$/);
    expect(live.last4).toBe(live.secret.slice(-4));
    expect(hashApiKey(live.secret)).toBe(live.hash);
    expect(live.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(live.secret).not.toBe(live.hash);
  });

  it("reads a bearer key and rejects anything else", () => {
    const { secret } = generateApiKey("test");
    expect(bearerApiKey(`Bearer ${secret}`)).toBe(secret);
    expect(bearerApiKey("Bearer nope")).toBeNull();
    expect(bearerApiKey(null)).toBeNull();
  });

  it("blocks live order creation while the Stripe key is a test key", () => {
    expect(liveOrderPostBlocked("cp_live_", "sk_test_123")).toBe(true);
    expect(liveOrderPostBlocked("cp_test_", "sk_test_123")).toBe(false);
    expect(liveOrderPostBlocked("cp_live_", "sk_live_123")).toBe(false);
  });

  it("returns lastUsedAt and never the hash", () => {
    const body = publicApiKey({
      id: "key-1",
      name: "Production",
      prefix: "cp_live_",
      last4: "ab12",
      createdAt: "2026-10-12T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(body.lastUsedAt).toBeNull();
    expect(body).not.toHaveProperty("secret");
    expect(body).not.toHaveProperty("keyHash");
    expect(
      publicApiKey({ ...body, lastUsedAt: "2026-10-12T01:00:00.000Z" }).lastUsedAt,
    ).toBe("2026-10-12T01:00:00.000Z");
  });

  it("validates name and mode", () => {
    expect(parseApiKeyMode("test")).toBe("test");
    expect(parseApiKeyName("  Production  ")).toBe("Production");
    expect(() => parseApiKeyMode("sandbox")).toThrowError(HttpError);
    try {
      parseApiKeyName("");
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: "validation_error" });
    }
  });
});
