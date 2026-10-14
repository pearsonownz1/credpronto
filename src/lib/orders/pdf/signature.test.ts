import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadOwnerSignature, OWNER_SIGNATURE_WIDTH_PT, tintSignaturePng } from "./signature";

function rgba(png: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png[offset]! * 2 ** 24 + png[offset + 1]! * 2 ** 16 + png[offset + 2]! * 2 ** 8 + png[offset + 3]!;
    const type = Buffer.from(png.subarray(offset + 4, offset + 8)).toString("latin1");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data[0]! * 2 ** 24 + data[1]! * 2 ** 16 + data[2]! * 2 ** 8 + data[3]!;
      height = data[4]! * 2 ** 24 + data[5]! * 2 ** 16 + data[6]! * 2 ** 8 + data[7]!;
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) pixels.set(inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  return { width, height, pixels };
}

describe("owner signature", () => {
  it("tints grayscale ink to #1a1f36 and keeps the transparent ground", () => {
    const source = loadOwnerSignature();
    expect(Array.from(source.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(source[25]).toBe(4);
    expect(OWNER_SIGNATURE_WIDTH_PT).toBe(135);

    const tinted = rgba(tintSignaturePng(source));
    expect(tinted.width).toBe(278);
    expect(tinted.height).toBe(190);
    expect(tinted.pixels[3]).toBe(0);

    let ink = 0;
    for (let i = 0; i < tinted.pixels.length; i += 4) {
      const alpha = tinted.pixels[i + 3] ?? 0;
      if (alpha < 20) continue;
      ink += 1;
      expect(tinted.pixels[i]).toBe(0x1a);
      expect(tinted.pixels[i + 1]).toBe(0x1f);
      expect(tinted.pixels[i + 2]).toBe(0x36);
    }
    expect(ink).toBeGreaterThan(1000);
  });
});
