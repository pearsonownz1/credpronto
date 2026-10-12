import { describe, expect, it } from "vitest";
import { callbackUrl, safeNextPath } from "./redirect";

describe("auth redirect", () => {
  it("keeps a relative next path", () => {
    expect(safeNextPath("/orders")).toBe("/orders");
    expect(callbackUrl("https://credpronto.com/", "/orders")).toBe(
      "https://credpronto.com/auth/callback?next=%2Forders",
    );
  });

  it("rejects open redirects", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
