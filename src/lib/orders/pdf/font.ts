import { readFileSync } from "node:fs";
import path from "node:path";

let cached: Uint8Array | null = null;

export function notoSansPath(): string {
  return path.join(process.cwd(), "src/lib/orders/pdf/NotoSans-Regular.ttf");
}

/** Noto Sans Regular (SIL OFL 1.1). See OFL.txt next to the font file. */
export function loadNotoSans(): Uint8Array {
  if (!cached) {
    cached = new Uint8Array(readFileSync(notoSansPath()));
  }
  return cached;
}
