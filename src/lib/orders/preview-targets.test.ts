import { describe, expect, it } from "vitest";
import { FINALS_BUCKET, PREVIEW_URL_SECONDS } from "./constants";
import { previewSignedTargets } from "./preview-targets";

describe("preview signed targets", () => {
  it("points the viewer at originals and previews, never finals", () => {
    const targets = previewSignedTargets({
      combinedOriginalPath: "order-1/original-combined.pdf",
      previewPath: "order-1/preview-v1.pdf",
    });

    expect(targets.original.bucket).toBe("originals");
    expect(targets.translation.bucket).toBe("previews");
    expect([targets.original.bucket, targets.translation.bucket]).not.toContain(FINALS_BUCKET);
    expect(PREVIEW_URL_SECONDS).toBe(600);
  });

  it("refuses a preview path that addresses the finals bucket", () => {
    expect(() =>
      previewSignedTargets({
        combinedOriginalPath: "order-1/original-combined.pdf",
        previewPath: "finals/translation-v1.pdf",
      }),
    ).toThrow(/finals/);
  });
});
