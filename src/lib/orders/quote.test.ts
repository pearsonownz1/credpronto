import { describe, expect, it } from "vitest";
import { UNIT_PRICE_CENTS } from "./constants";
import { SAME_LANGUAGE_REASON, decideQuote, englishSourceWithoutTarget } from "./quote";

const ready = {
  billableUnits: [1, 1],
  pageNeedsReview: [false, false],
  language: "fr",
  confidence: 0.94,
  detectionAvailable: true,
  languagesDisagree: false,
};

describe("decideQuote image quality", () => {
  it("does not quote a photo below the legibility gate", () => {
    const decision = decideQuote({ ...ready, imageQuality: true });
    expect(decision.status).toBe("needs_review");
    expect(decision.reviewReason).toBe("image_quality");
    expect(decision.etaHours).toBe(24);
    expect(decision.billablePages).toBe(2);
    expect(decision.totalCents).toBe(2 * UNIT_PRICE_CENTS);
  });

  it("uses image_quality even when language detection is also weak", () => {
    const decision = decideQuote({
      ...ready,
      confidence: 0.1,
      imageQuality: true,
    });
    expect(decision.reviewReason).toBe("image_quality");
    expect(decision.status).toBe("needs_review");
  });

  it("still quotes when the photo is readable", () => {
    const decision = decideQuote(ready);
    expect(decision.status).toBe("quoted");
    expect(decision.reviewReason).toBeNull();
    expect(decision.etaHours).toBe(1);
  });

  it("holds English with no chosen target instead of quoting en to en", () => {
    expect(englishSourceWithoutTarget("en", "en")).toBe(true);
    expect(englishSourceWithoutTarget("en", null)).toBe(true);
    expect(englishSourceWithoutTarget("es", "en")).toBe(false);
    const held = decideQuote({ ...ready, language: "en" });
    expect(held.status).toBe("needs_review");
    expect(held.reviewReason).toBe(SAME_LANGUAGE_REASON);
    expect(held.totalCents).toBe(2 * UNIT_PRICE_CENTS);
    const quoted = decideQuote({ ...ready, language: "en", targetLanguage: "es" });
    expect(quoted.status).toBe("quoted");
    expect(quoted.reviewReason).toBeNull();
  });
});
