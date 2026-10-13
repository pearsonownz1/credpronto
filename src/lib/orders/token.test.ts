import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MOCK_TOKEN } from "@/lib/flow/session";
import { generateOrderToken, hashOrderToken, isOrderId, isOrderToken } from "./token";

describe("order token hashing", () => {
  it("stores a 64-char hex sha256 of the raw token, not the token itself", () => {
    const token = generateOrderToken();
    const hash = hashOrderToken(token);

    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("hashes the exact string, so a different character is a different link", () => {
    expect(hashOrderToken("abc")).not.toBe(hashOrderToken("abd"));
  });

  it("accepts only base64url tokens in the email-link length range", () => {
    const token = generateOrderToken();
    expect(isOrderToken(token)).toBe(true);
    expect(isOrderToken(token.slice(0, 42))).toBe(false);
    expect(isOrderToken(`${token}!`)).toBe(false);
    expect(isOrderToken("a".repeat(129))).toBe(false);
    expect(isOrderId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isOrderId(token)).toBe(false);
    expect(isOrderToken("11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(isOrderToken(MOCK_TOKEN)).toBe(true);
  });
});
