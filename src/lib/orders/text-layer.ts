/** Minimal shape of a pdf.js text item. */
export type TextItemLike = {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
};

/**
 * Join pdf.js text items into page text.
 *
 * pdf.js marks most line ends with hasEOL but glues other items together with
 * nothing in between, which merges separate glyphs (seal ring lettering, table
 * cells) into one "word". We add a space between two items unless the second
 * one starts right where the first ends on the same baseline direction.
 */
export function joinTextItems(items: TextItemLike[]): string {
  let out = "";
  let prev: TextItemLike | null = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    if (prev) {
      if (prev.hasEOL) out += "\n";
      else if (!continues(prev, item)) out += " ";
    }
    out += item.str;
    prev = item;
  }
  return out;
}

function continues(prev: TextItemLike, next: TextItemLike): boolean {
  if (!prev.str || !next.str) return true;
  if (/\s$/.test(prev.str) || /^\s/.test(next.str)) return true;
  const [a = 1, b = 0, , , x0 = 0, y0 = 0] = prev.transform;
  const [na = 1, nb = 0, , , x1 = 0, y1 = 0] = next.transform;
  const size = Math.hypot(a, b) || 1;
  const nsize = Math.hypot(na, nb) || 1;
  // Different text direction: not one word.
  const cos = (a * na + b * nb) / (size * nsize);
  if (cos < 0.99) return false;
  const ux = a / size;
  const uy = b / size;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const along = dx * ux + dy * uy;
  const across = -dx * uy + dy * ux;
  if (Math.abs(across) > size * 0.6) return false;
  const gap = along - prev.width;
  return gap > -size * 0.3 && gap < size * 0.25;
}
