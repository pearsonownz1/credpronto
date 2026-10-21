import { describe, expect, it } from "vitest";
import { callbackUrl, confirmUrl, isEmailOtpType, safeNextPath } from "./redirect";

describe("auth redirect", () => {
  it("keeps a relative next path", () => {
    expect(safeNextPath("/orders")).toBe("/orders");
    expect(callbackUrl("https://credpronto.com/", "/orders")).toBe(
      "https://credpronto.com/auth/callback?next=%2Forders",
    );
  });

  it("builds a token_hash confirm link and drops a bad order token", () => {
    const url = new URL(
      confirmUrl("https://credpronto.com/", {
        tokenHash: "sample-hash",
        type: "magiclink",
        next: "/account",
        orderToken: "not a token",
      }),
    );
    expect(url.origin).toBe("https://credpronto.com");
    expect(url.pathname).toBe("/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("sample-hash");
    expect(url.searchParams.get("type")).toBe("magiclink");
    expect(url.searchParams.get("next")).toBe("/account");
    expect(url.searchParams.get("order")).toBeNull();
    expect(isEmailOtpType("signup")).toBe(true);
    expect(isEmailOtpType("code")).toBe(false);
    expect(safeNextPath("https://evil.example", "/account")).toBe("/account");
  });

  it("rejects open redirects", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
