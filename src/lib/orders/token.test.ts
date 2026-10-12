import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateOrderToken, hashOrderToken } from "./token";

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
});
