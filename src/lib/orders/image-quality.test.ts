import { describe, expect, it } from "vitest";
import { MIN_LEGIBILITY } from "./constants";
import { failsImageQuality, pageQuality, READABLE_PAGE_WORDS, replacementAllowed, retakeMessage } from "./image-quality";

const certificate = Array.from({ length: READABLE_PAGE_WORDS }, () => "وثيقة").join(" ");

describe("image quality gate", () => {
  it("holds a blurry photo below the legibility threshold", () => {
    expect(failsImageQuality(0.42, true)).toBe(true);
    expect(failsImageQuality(MIN_LEGIBILITY, true)).toBe(false);
    expect(failsImageQuality(0.2, false)).toBe(false);
    expect(failsImageQuality(null, true)).toBe(false);
  });

  it("does not trust a high score when a severe flag is set", () => {
    const held = pageQuality({ score: 0.85, visual: true, flags: ["blurry", "too_dark"] });
    expect(held.failed).toBe(true);
    expect(held.score).toBeLessThan(MIN_LEGIBILITY);
    expect(held.message).toContain("blurry");
    expect(held.message).toContain("too dark");
    expect(held.message).toContain("upload a replacement");

    expect(failsImageQuality(0.85, true, ["unreadable_fields"])).toBe(true);
    expect(failsImageQuality(0.85, true, ["cropped"])).toBe(true);
    expect(failsImageQuality(0.85, false, ["blurry"])).toBe(false);
  });

  it("writes retake instructions for every flagged page", () => {
    const glare = pageQuality({ score: 0.92, visual: true, flags: ["glare"] });
    expect(glare.failed).toBe(false);
    expect(glare.score).toBe(0.92);
    expect(glare.message).toContain("Glare");
    expect(glare.message).toContain("upload a replacement");

    const lowScore = pageQuality({ score: 0.4, visual: true, flags: [] });
    expect(lowScore.failed).toBe(true);
    expect(lowScore.message).toContain("hard to read");
  });

  it("names the problems and asks for a replacement", () => {
    const message = retakeMessage(["blurry", "glare", "not-a-flag"]);
    expect(message).toContain("blurry");
    expect(message).toContain("Glare");
    expect(message).toContain("upload a replacement");
    expect(message).not.toContain("not-a-flag");
  });

  it("keeps a readable certificate photo when only handwriting flags are set", () => {
    const readable = pageQuality({
      score: 0.42,
      visual: true,
      flags: ["too_dark", "unreadable_fields"],
      text: certificate,
      needsReview: false,
    });
    expect(readable.failed).toBe(false);
    expect(readable.score).toBeGreaterThanOrEqual(MIN_LEGIBILITY);
    expect(readable.message).toBeNull();

    const fourteen = pageQuality({
      score: 0.42,
      visual: true,
      flags: ["too_dark"],
      text: Array.from({ length: READABLE_PAGE_WORDS - 1 }, () => "وثيقة").join(" "),
      needsReview: false,
    });
    expect(fourteen.failed).toBe(true);

    const stillBlurry = pageQuality({
      score: 0.85,
      visual: true,
      flags: ["blurry", "too_dark"],
      text: certificate,
      needsReview: false,
    });
    expect(stillBlurry.failed).toBe(true);

    const cropped = pageQuality({
      score: 0.9,
      visual: true,
      flags: ["cropped", "unreadable_fields"],
      text: certificate,
      needsReview: false,
    });
    expect(cropped.failed).toBe(true);

    const readerUnsure = pageQuality({
      score: 0.9,
      visual: true,
      flags: ["too_dark"],
      text: certificate,
      needsReview: true,
    });
    expect(readerUnsure.failed).toBe(true);
  });

  it("allows a replacement only while the order is held for image quality", () => {
    expect(replacementAllowed({ status: "needs_review", reviewReason: "image_quality" })).toBe(true);
    expect(replacementAllowed({ status: "needs_review", reviewReason: "Language detection is low." })).toBe(false);
    expect(replacementAllowed({ status: "quoted", reviewReason: "image_quality" })).toBe(false);
    expect(replacementAllowed({ status: "draft", reviewReason: null })).toBe(false);
  });
});
