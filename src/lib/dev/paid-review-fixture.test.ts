import { describe, expect, it } from "vitest";
import { needsReviewFixture, paidReviewFixtureEnabled } from "./paid-review-fixture";

describe("paid review fixture", () => {
  it("stays off in production and on for preview and local", () => {
    expect(paidReviewFixtureEnabled("production")).toBe(false);
    expect(paidReviewFixtureEnabled("preview")).toBe(true);
    expect(paidReviewFixtureEnabled("development")).toBe(true);
    expect(paidReviewFixtureEnabled(undefined)).toBe(true);
  });

  it("uses the needs_review mock order", () => {
    const fixture = needsReviewFixture();
    expect(fixture).toMatchObject({
      id: "CP-24802",
      status: "needs_review",
      email: "ada@example.com",
      totalCents: 2985,
      paidAt: null,
      serviceType: "translation",
    });
  });
});
