/**
 * Text shown as the admin source. pdf.js sometimes marks every glyph as its
 * own line, and a string spread into an array is one character per entry.
 * Both come back as a single readable block.
 */
export function sourceTextForDisplay(value: unknown): string | null {
  if (typeof value === "string") {
    const joined = collapseCharacterLines(value);
    return joined.trim() ? joined : null;
  }
  if (!Array.isArray(value)) return null;
  const parts = value.filter((item): item is string => typeof item === "string");
  if (parts.length === 0) return null;
  const joined = parts.every((part) => Array.from(part).length <= 1)
    ? parts
        .map((part) => part.trim() || " ")
        .join("")
        .replace(/[ ]{2,}/g, " ")
        .trim()
    : parts.join("\n");
  return joined.trim() ? joined : null;
}

/** Join a run of single-character lines. A blank line becomes a space. */
export function collapseCharacterLines(text: string): string {
  const lines = text.split(/\n/);
  const content = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (content.length < 6) return text;
  const singles = content.filter((line) => Array.from(line).length === 1).length;
  if (singles / content.length < 0.75) return text;

  let out = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (out && !/[\n ]$/.test(out)) out += " ";
      continue;
    }
    if (Array.from(trimmed).length === 1) {
      out += trimmed;
      continue;
    }
    if (out && !/[\n ]$/.test(out)) out += " ";
    out += trimmed;
  }
  return out.replace(/[ ]{2,}/g, " ").trim();
}
