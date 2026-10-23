import { describe, expect, it } from "vitest";
import { previewWatermarkSvg } from "./watermark";

describe("preview watermark", () => {
  it("tiles PREVIEW in brand blue at 9% opacity, rotated -30 degrees", () => {
    const svg = previewWatermarkSvg();
    expect(svg).toContain(">PREVIEW</text>");
    expect(svg).toContain('fill="#1f5eff"');
    expect(svg).toContain('fill-opacity="0.09"');
    expect(svg).toContain("rotate(-30 ");
  });
});
