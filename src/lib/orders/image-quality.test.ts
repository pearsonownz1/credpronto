import { describe, expect, it } from "vitest";
import { MIN_LEGIBILITY } from "./constants";
import { failsImageQuality, replacementAllowed, retakeMessage } from "./image-quality";

describe("image quality gate", () => {
  it("holds a blurry photo below the legibility threshold", () => {
    expect(failsImageQuality(0.42, true)).toBe(true);
    expect(failsImageQuality(MIN_LEGIBILITY, true)).toBe(false);
    expect(failsImageQuality(0.2, false)).toBe(false);
    expect(failsImageQuality(null, true)).toBe(false);
  });

  it("names the problems and asks for a replacement", () => {
    const message = retakeMessage(["blurry", "glare", "not-a-flag"]);
    expect(message).toContain("blurry");
    expect(message).toContain("Glare");
    expect(message).toContain("upload a replacement");
    expect(message).not.toContain("not-a-flag");
  });

  it("allows a replacement only while the order is held for image quality", () => {
    expect(replacementAllowed({ status: "needs_review", reviewReason: "image_quality" })).toBe(true);
    expect(replacementAllowed({ status: "needs_review", reviewReason: "Language detection is low." })).toBe(false);
    expect(replacementAllowed({ status: "quoted", reviewReason: "image_quality" })).toBe(false);
    expect(replacementAllowed({ status: "draft", reviewReason: null })).toBe(false);
  });
});
