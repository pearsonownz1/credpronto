import sharp from "sharp";

/**
 * Crop the holder portrait from a certificate scan.
 * A window has to look like a photograph (mid-gray, high detail) in the upper
 * middle of the page. Text, seals, and letterheads fail that check and return null.
 */
export async function cropHolderPhoto(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const base = sharp(bytes).rotate();
    const meta = await base.metadata();
    const fullW = meta.width ?? 0;
    const fullH = meta.height ?? 0;
    if (fullW < 120 || fullH < 120) return null;

    const sampleW = 160;
    const sampleH = Math.max(1, Math.round(fullH * (sampleW / fullW)));
    const raw = await sharp(bytes).rotate().resize(sampleW, sampleH).greyscale().raw().toBuffer();
    const winW = 28;
    const winH = 38;
    if (sampleH <= winH + 4 || sampleW <= winW + 4) return null;

    let best: { x: number; y: number; score: number; std: number } | null = null;
    for (let y = 2; y < sampleH - winH - 2; y += 2) {
      for (let x = Math.round(sampleW * 0.28); x < sampleW * 0.72 - winW; x += 2) {
        let sum = 0;
        let sum2 = 0;
        let dark = 0;
        let n = 0;
        for (let yy = y; yy < y + winH; yy += 1) {
          for (let xx = x; xx < x + winW; xx += 1) {
            const value = raw[yy * sampleW + xx] ?? 255;
            sum += value;
            sum2 += value * value;
            n += 1;
            if (value < 150) dark += 1;
          }
        }
        if (n === 0) continue;
        const mean = sum / n;
        const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
        const darkRatio = dark / n;
        if (mean > 190 || mean < 60 || darkRatio < 0.4 || std < 50) continue;
        const score = std * Math.min(darkRatio, 0.75);
        if (!best || score > best.score) best = { x, y, score, std };
      }
    }
    if (!best || best.score < 30) return null;

    const scaleX = fullW / sampleW;
    const scaleY = fullH / sampleH;
    const padX = 3;
    const padY = 3;
    let left = Math.round((best.x - padX) * scaleX);
    let top = Math.round((best.y - padY) * scaleY);
    let width = Math.round((winW + padX * 2) * scaleX);
    let height = Math.round((winH + padY * 2) * scaleY);
    left = Math.max(0, left);
    top = Math.max(0, top);
    if (left + width > fullW) width = fullW - left;
    if (top + height > fullH) height = fullH - top;
    if (width < 40 || height < 50) return null;
    const aspect = width / height;
    if (aspect < 0.5 || aspect > 1) return null;
    if ((width * height) / (fullW * fullH) > 0.28) return null;

    const png = await sharp(bytes).rotate().extract({ left, top, width, height }).png().toBuffer();
    return png.byteLength > 80 ? new Uint8Array(png) : null;
  } catch {
    return null;
  }
}
