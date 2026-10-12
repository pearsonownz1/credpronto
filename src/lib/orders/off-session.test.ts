import { describe, expect, it } from "vitest";
import { offSessionDecision } from "./off-session";

describe("off-session charge", () => {
  it("requires a saved card and a Stripe test key", () => {
    expect(offSessionDecision({ hasCard: false, stripeKey: "sk_test_123" })).toEqual({
      action: "refuse",
      code: "card_required",
      message: "A saved card is required",
    });
    expect(offSessionDecision({ hasCard: true, stripeKey: null }).action).toBe("refuse");
    expect(offSessionDecision({ hasCard: true, stripeKey: "sk_test_123" })).toEqual({ action: "charge" });
  });
});
