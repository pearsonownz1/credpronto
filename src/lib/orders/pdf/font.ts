import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";

type GlyphFont = {
  glyphForCodePoint(codePoint: number): { id: number; name?: string | null };
};

export type FontFaceId = "regular" | "italic" | "symbols" | "cjk-sc" | "cjk-jp" | "cjk-kr";

export type FontFace = {
  id: FontFaceId;
  /** Italic face is only preferred when the caller asks for italic styling. */
  italic: boolean;
  bytes: Uint8Array;
  hasGlyph(codePoint: number): boolean;
};

const FILES: Record<FontFaceId, string> = {
  regular: "NotoSans-Regular.ttf",
  italic: "NotoSans-Italic.ttf",
  symbols: "NotoSansSymbols2-Regular.ttf",
  "cjk-sc": "NotoSansSC-Regular.ttf",
  "cjk-jp": "NotoSansJP-Regular.ttf",
  "cjk-kr": "NotoSansKR-Regular.ttf",
};

/**
 * Upright coverage order: Latin (full Latin Extended A/B in Noto Sans),
 * then symbols, then CJK subsets (Simplified Chinese, Japanese, Korean).
 * The first face that has the code point wins.
 */
const UPRIGHT_ORDER: FontFaceId[] = ["regular", "symbols", "cjk-sc", "cjk-jp", "cjk-kr"];

const cache = new Map<FontFaceId, FontFace>();
const byteCache = new Map<string, Uint8Array>();

function readFace(filename: string): Uint8Array {
  const existing = byteCache.get(filename);
  if (existing) return existing;
  const bytes = new Uint8Array(readFileSync(path.join(process.cwd(), "src/lib/orders/pdf", filename)));
  byteCache.set(filename, bytes);
  return bytes;
}

function openFace(id: FontFaceId): FontFace {
  const existing = cache.get(id);
  if (existing) return existing;
  const bytes = readFace(FILES[id]);
  const font = fontkit.create(Buffer.from(bytes)) as GlyphFont;
  const face: FontFace = {
    id,
    italic: id === "italic",
    bytes,
    hasGlyph(codePoint: number) {
      if (codePoint < 32) return false;
      const glyph = font.glyphForCodePoint(codePoint);
      return glyph.id !== 0 && glyph.name !== ".notdef";
    },
  };
  cache.set(id, face);
  return face;
}

/** Noto Sans Regular (SIL OFL). Latin, Latin Extended, Greek, and Cyrillic. Italic, symbols, and CJK subset faces live beside this file. */
export function loadNotoSans(): Uint8Array {
  return openFace("regular").bytes;
}

export function notoSansPath(): string {
  return path.join(process.cwd(), "src/lib/orders/pdf", FILES.regular);
}

export function fontFace(id: FontFaceId): FontFace {
  return openFace(id);
}

/**
 * Per-glyph face. Italic notes try Noto Sans Italic first, then the upright
 * chain, so a CJK name inside an italic note still uses the CJK font.
 */
export function faceForCodePoint(codePoint: number, italic = false): FontFace | null {
  if (italic) {
    const oblique = openFace("italic");
    if (oblique.hasGlyph(codePoint)) return oblique;
  }
  for (const id of UPRIGHT_ORDER) {
    const face = openFace(id);
    if (face.hasGlyph(codePoint)) return face;
  }
  return null;
}

export function facesForText(text: string, italic = false): FontFace[] {
  const seen = new Set<FontFaceId>();
  const faces: FontFace[] = [];
  for (const char of Array.from(text)) {
    const face = faceForCodePoint(char.codePointAt(0) ?? 0, italic);
    if (!face || seen.has(face.id)) continue;
    seen.add(face.id);
    faces.push(face);
  }
  if (!seen.has("regular")) faces.unshift(openFace("regular"));
  return faces;
}
