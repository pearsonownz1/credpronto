import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";

type GlyphFont = {
  glyphForCodePoint(codePoint: number): { id: number; name?: string | null };
};

export type FontFaceId =
  | "regular"
  | "italic"
  | "symbols"
  | "cjk-sc"
  | "cjk-jp"
  | "cjk-kr"
  | "serif"
  | "serif-bold";

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
  serif: "LiberationSerif-Regular.ttf",
  "serif-bold": "LiberationSerif-Bold.ttf",
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

/** Certificate pages. Missing glyphs fall back to the upright sans chain. */
export function serifFace(bold: boolean): FontFace {
  return openFace(bold ? "serif-bold" : "serif");
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

type SubsetFont = {
  getGlyph(id: number): {
    advanceWidth: number;
    _decode(): { numberOfContours: number; components?: Array<{ glyphID: number; pos: number }> } | null;
    _getMetrics(): { leftBearing: number };
  };
  loca: { offsets: number[] };
  _getTableStream(tag: string): { pos: number; readBuffer(length: number): SubsetBuffer };
  createSubset(): SubsetBuilder;
};

type SubsetBuffer = Uint8Array & {
  constructor: { from(input: Uint8Array): SubsetBuffer };
};

type SubsetBuilder = {
  font: SubsetFont;
  glyf: SubsetBuffer[];
  loca: { offsets: number[] };
  hmtx: { metrics: Array<{ advance: number; bearing: number }> };
  offset: number;
  includeGlyph(glyphId: number): number;
  _addGlyph(glyphId: number): number;
};

/**
 * pdf-lib subsets TrueType with a short `loca` table whenever the subset is
 * under 64KB. That format stores offsets divided by two, so an odd glyph
 * length (common in the CJK faces) drops the low bit and every later outline
 * is shifted. Copy each outline and pad it to 4 bytes before it is packed.
 */
function addPaddedGlyph(subset: SubsetBuilder, gid: number): number {
  const glyph = subset.font.getGlyph(gid);
  const decoded = glyph._decode();
  const offsets = subset.font.loca.offsets;
  const start = offsets[gid] ?? 0;
  const end = offsets[gid + 1] ?? start;
  const stream = subset.font._getTableStream("glyf");
  stream.pos += start;
  const raw = stream.readBuffer(Math.max(0, end - start));
  const bytes = Uint8Array.from(raw);
  if (decoded && decoded.numberOfContours < 0) {
    for (const component of decoded.components ?? []) {
      const nextId = subset.includeGlyph(component.glyphID);
      bytes[component.pos] = (nextId >> 8) & 0xff;
      bytes[component.pos + 1] = nextId & 0xff;
    }
  }
  const pad = (4 - (bytes.length % 4)) % 4;
  const padded = new Uint8Array(bytes.length + pad);
  padded.set(bytes);
  const buffer = raw.constructor.from(padded);
  subset.glyf.push(buffer);
  subset.loca.offsets.push(subset.offset);
  subset.hmtx.metrics.push({
    advance: glyph.advanceWidth,
    bearing: Math.round(glyph._getMetrics().leftBearing),
  });
  subset.offset += buffer.length;
  return subset.glyf.length - 1;
}

/** Fontkit whose subsets keep every encoded glyph's outline aligned. */
export function stableFontkit(): typeof fontkit {
  const create = (data: Uint8Array) => {
    const font = fontkit.create(data) as unknown as SubsetFont;
    const original = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = original();
      subset._addGlyph = (glyphId: number) => addPaddedGlyph(subset, glyphId);
      return subset;
    };
    return font;
  };
  return { create } as unknown as typeof fontkit;
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
