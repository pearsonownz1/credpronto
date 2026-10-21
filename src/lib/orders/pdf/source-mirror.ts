import type { BlockColumn, RenderBlock } from "./layout";

export type SegmentRole =
  | "logo"
  | "date"
  | "address"
  | "kv"
  | "body"
  | "closing"
  | "organization"
  | "signature"
  | "list"
  | "heading"
  | "box"
  | "photo";

export type SourceSegment = {
  id: number;
  role: SegmentRole;
  text: string;
  column?: BlockColumn;
  bold?: boolean;
  caps?: boolean;
};

export type LayoutPlan = {
  kind: "letter" | "certificate";
  segments: SourceSegment[];
};

const DATE_LINE = /^[\p{L}.'’\-\s]{0,40},?\s*\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{2,4}\s*$/u;
const CLOSING_LINE =
  /^(saygılarımızla|saygilarimizla|saygılarımla|sincerely|sincerely yours|respectfully|respectfully yours|kind regards|best regards|yours faithfully|cordialement|atentamente|cordialmente)\b[,.]?\s*$/iu;
const LIST_HEAD = /^(ek|ekler|encl\.?|enclosures?|attachments?|adjunto|anexo|annex|pi[eè]ce)\b/iu;
const LIST_ITEM = /^\d+\s*[).]\s+\S/;
const STREET = /\b(bulvarı?|caddesi?|sokağı?|mahallesi|street|avenue|boulevard|blvd|road|rue|calle|strasse)\b/iu;
const META_LABEL =
  /^(evrak\s*no|belge\s*no|konu|sayı|sayi|ref|reference|document\s*no|subject|our\s*ref|your\s*ref|asunto|objet|objeto)\b/iu;
const CLOSING_WORD =
  /\b(saygılarımızla|saygilarimizla|sincerely|respectfully|kind regards|best regards|yours faithfully|cordialement|atentamente|cordialmente)\b,?/iu;
const LIST_WORD = /\b(encl(?:osure)?s?|attachments?|annex|ek)\b\.?\s*:?/iu;

function linesOf(text: string): string[] {
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function isAllCapsLine(line: string): boolean {
  const letters = line.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return false;
  return letters.every((char) => char.toUpperCase() === char && char.toLowerCase() !== char);
}

function kvOf(line: string): { label: string; value: string } | null {
  const match = line.match(/^(.{1,48}?)\s*:\s*(\S.*?)\s*$/);
  if (!match?.[1] || !match[2]) return null;
  const label = match[1].trim();
  const value = match[2].trim();
  if (STREET.test(label)) return null;
  if (words(label).length > 5 || words(value).length > 8) return null;
  if (META_LABEL.test(label)) return { label, value };
  if (words(label).length <= 3 && value.length <= 40 && words(value).length <= 6) return { label, value };
  return null;
}

function isMetaKv(line: string): boolean {
  const kv = kvOf(line);
  return Boolean(kv && META_LABEL.test(kv.label));
}

function isOrganization(line: string): boolean {
  return /\b(a\.?\s*ş\.?|a\.?\s*s\.?|inc\.?|ltd\.?|llc|gmbh|bank|head office|genel\s+m[üu]d[üu]rl[üu]k|headquarters)\b/iu.test(
    line,
  );
}

function isRole(line: string): boolean {
  return /\b(m[üu]d[üu]r|başkan|baskan|y[öo]netim\s+kurulu|[üu]yesi|yard[ıi]mc|manager|director|president|member|counsel|secretary|chair|attorney)\b/iu.test(
    line,
  );
}

function isPerson(line: string): boolean {
  const tokens = words(line.replace(/\./g, " "));
  if (tokens.length < 2 || tokens.length > 5) return false;
  if (line.length > 42 || isRole(line) || isOrganization(line) || kvOf(line)) return false;
  return /\p{Lu}/u.test(line);
}

function withIds(segments: Array<Omit<SourceSegment, "id">>): SourceSegment[] {
  return segments.map((segment, index) => ({ ...segment, id: index + 1 }));
}

function segmentLetter(lines: string[]): LayoutPlan | null {
  const closingAt = lines.findIndex((line) => CLOSING_LINE.test(line));
  const listAt = lines.findIndex((line, index) => LIST_HEAD.test(line) || (index > closingAt && closingAt >= 0 && LIST_ITEM.test(line)));
  const dateAt = lines.findIndex((line) => DATE_LINE.test(line) && line.length <= 60);
  const metaAt = lines
    .map((line, index) => (isMetaKv(line) ? index : -1))
    .filter((index) => index >= 0);
  const hasClosing = closingAt >= 0;
  const hasList = listAt >= 0;
  if (!(hasClosing || hasList) || (metaAt.length === 0 && dateAt < 0)) return null;
  if (lines.some((line) => line.length > 80 && isAllCapsLine(line)) && metaAt.length === 0) return null;

  const endOfHead = listAt >= 0 ? listAt : lines.length;
  const closing = hasClosing ? closingAt : endOfHead;
  const segments: Array<Omit<SourceSegment, "id">> = [];

  const logoLines = lines.slice(0, dateAt >= 0 ? dateAt : 0).filter((line) => words(line).length <= 6 && line.length <= 40);
  if (logoLines.length) segments.push({ role: "logo", text: logoLines.join(" ") });
  if (dateAt >= 0) segments.push({ role: "date", text: lines[dateAt] ?? "" });

  const addressStart = dateAt >= 0 ? dateAt + 1 : logoLines.length;
  const kvStart = metaAt.find((index) => index >= addressStart) ?? closing;
  const addressLines = lines.slice(addressStart, kvStart).filter((line) => !isMetaKv(line));
  const streetAt = addressLines.findIndex((line) => STREET.test(line) || /\b\d{4,}\b/.test(line));
  if (addressLines.length) {
    if (streetAt > 0) {
      segments.push({ role: "address", text: addressLines.slice(0, streetAt).join("\n"), bold: true });
      segments.push({ role: "address", text: addressLines.slice(streetAt).join("\n") });
    } else {
      segments.push({ role: "address", text: addressLines.join("\n"), bold: true });
    }
  }

  for (const index of metaAt) {
    if (index < addressStart || index >= closing) continue;
    const kv = kvOf(lines[index] ?? "");
    if (!kv) continue;
    segments.push({ role: "kv", text: `${kv.label}: ${kv.value}` });
  }

  const lastKv = metaAt.filter((index) => index < closing).at(-1) ?? kvStart - 1;
  const bodyLines = lines.slice(Math.max(addressStart, lastKv + 1), closing);
  if (bodyLines.length) segments.push({ role: "body", text: bodyLines.join(" ") });
  if (hasClosing) segments.push({ role: "closing", text: (lines[closingAt] ?? "").replace(/[,.]\s*$/, ",") });

  const tail = lines.slice(closing + 1, endOfHead);
  let orgOpen = true;
  let signature: string[] | null = null;
  const flushSignature = () => {
    if (!signature?.length) return;
    const column: BlockColumn = segments.filter((item) => item.role === "signature").length === 0 ? "left" : "right";
    segments.push({ role: "signature", text: signature.join("\n"), column });
    signature = null;
  };
  for (const line of tail) {
    if (orgOpen && (isOrganization(line) || (!isPerson(line) && !isRole(line)))) {
      const firstOrg = !segments.some((item) => item.role === "organization");
      segments.push({ role: "organization", text: line, bold: firstOrg && isOrganization(line) });
      continue;
    }
    orgOpen = false;
    if (isPerson(line) && signature) flushSignature();
    signature ??= [];
    signature.push(line);
  }
  flushSignature();

  if (listAt >= 0) {
    const listLines = lines.slice(listAt);
    const items: string[] = [];
    let label = "Attachment";
    for (const line of listLines) {
      const head = line.match(/^(ek|ekler|encl\.?|enclosures?|attachments?|adjunto|anexo|annex)\b\s*[:.]?\s*(.*)$/iu);
      if (head && items.length === 0) {
        label = (head[1] ?? "Attachment").replace(/\.$/, "");
        const rest = head[2]?.trim() ?? "";
        const inline = rest.match(/^\d+\s*[).]\s*(.*)$/);
        if (inline?.[1]) items.push(inline[1].trim());
        else if (rest) items.push(rest);
        continue;
      }
      const item = line.match(/^\d+\s*[).]\s*(.*)$/);
      if (item?.[1]) items.push(item[1].trim());
      else if (items.length) items[items.length - 1] = `${items[items.length - 1]} ${line}`.trim();
    }
    if (items.length) segments.push({ role: "list", text: `${label}:\n${items.join("\n")}` });
  }

  const structural = segments.filter((item) => item.role === "kv" || item.role === "list" || item.role === "signature" || item.role === "address").length;
  if (structural < 2) return null;
  return { kind: "letter", segments: withIds(segments) };
}

function bareBox(line: string): string | null {
  const match = line.match(/^(.{2,40}?)\s*:\s*$/);
  return match?.[1]?.trim() || null;
}

function segmentCertificate(lines: string[], portrait: boolean): LayoutPlan | null {
  const headings = lines.filter((line) => isAllCapsLine(line) && line.length <= 60 && words(line).length <= 8);
  const longCaps = lines.some((line) => line.length > 80 && isAllCapsLine(line));
  if (headings.length < 2 || !longCaps || lines.some((line) => CLOSING_LINE.test(line))) return null;

  const segments: Array<Omit<SourceSegment, "id">> = [];
  let boxes = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const labelOnly = bareBox(line);
    const next = lines[index + 1] ?? "";
    if (labelOnly && /^\d[\d\s]{1,12}$/.test(next)) {
      boxes += 1;
      segments.push({
        role: "box",
        text: `${labelOnly}: ${next.trim()}`,
        column: boxes === 1 ? "left" : boxes === 2 ? "right" : "full",
      });
      index += 1;
      continue;
    }
    const inline = line.match(/^(.{2,40}?)\s*:\s*(\d[\d\s]{1,12})$/);
    if (inline?.[1] && inline[2] && words(inline[1]).length <= 5) {
      boxes += 1;
      segments.push({
        role: "box",
        text: `${inline[1].trim()}: ${inline[2].trim()}`,
        column: boxes === 1 ? "left" : boxes === 2 ? "right" : "full",
      });
      continue;
    }
    if (isAllCapsLine(line) && line.length <= 60 && words(line).length <= 8 && segments.filter((item) => item.role === "heading").length < 2 && boxes === 0) {
      const headingCount = segments.filter((item) => item.role === "heading").length;
      segments.push({ role: "heading", text: line, caps: true, bold: headingCount === 1 });
      continue;
    }
    if (line.length > 80) {
      segments.push({ role: "body", text: line, caps: isAllCapsLine(line) });
      const tail = lines.slice(index + 1).filter((item) => item.length <= 60);
      if (tail.length) {
        segments.push({ role: "signature", text: tail.join("\n"), column: "right" });
      }
      break;
    }
  }
  if (boxes < 1 || !segments.some((item) => item.role === "heading")) return null;
  if (portrait) {
    const firstBox = segments.findIndex((item) => item.role === "box");
    const photo = { role: "photo" as const, text: "Holder's photo" };
    if (firstBox >= 0) segments.splice(firstBox + 1, 0, photo);
    else segments.push(photo);
  }
  return { kind: "certificate", segments: withIds(segments) };
}

/** Letter or certificate regions read from a photo's line-broken transcription. */
export function segmentSource(text: string, options?: { portrait?: boolean }): LayoutPlan | null {
  const lines = linesOf(text);
  if (lines.length < 4) return null;
  return segmentCertificate(lines, Boolean(options?.portrait)) ?? segmentLetter(lines);
}

function letterCovered(blocks: RenderBlock[]): boolean {
  const structural = blocks.some((block) => {
    if (block.type === "kv" || block.type === "address" || block.type === "list" || block.type === "logo" || block.type === "signature") {
      return true;
    }
    return block.type === "fields" && block.rows.length > 0;
  });
  return structural && blocks.length >= 3;
}

function certificateCovered(blocks: RenderBlock[]): boolean {
  return blocks.some((block) => block.type === "box" || block.type === "photo" || block.type === "seal");
}

/**
 * A photo transcription keeps the letter's lines, but the model often joins them
 * into one paragraph. That paragraph is a fallback, not a layout.
 */
export function layoutNeedsRestore(sourceText: string, blocks: RenderBlock[], options?: { portrait?: boolean }): LayoutPlan | null {
  const plan = segmentSource(sourceText, options);
  if (!plan) return null;
  if (plan.kind === "letter" && letterCovered(blocks)) return null;
  if (plan.kind === "certificate" && certificateCovered(blocks)) return null;
  return plan;
}

export function translatedProse(blocks: RenderBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading" || block.type === "note" || block.type === "logo") parts.push(block.text);
    else if (block.type === "address") parts.push(block.lines.join(" "));
    else if (block.type === "kv" || block.type === "box") parts.push(`${block.label}: ${block.value}`);
    else if (block.type === "fields") parts.push(block.rows.map((row) => `${row.label} ${row.value}`).join(" "));
    else if (block.type === "list") parts.push(`${block.label ?? ""}\n${block.items.join("\n")}`);
    else if (block.type === "signature") parts.push((block.lines ?? []).join(" "));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** A joined letter is not a form. Field splitting on "No" would drop the signature and the enclosures. */
export function joinedLetterParagraph(text: string): boolean {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length < 80) return false;
  return CLOSING_WORD.test(flat);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelBeforeColon(before: string): { label: string; start: number } | null {
  const tokens = before.trimEnd().split(/\s+/).filter(Boolean);
  const label: string[] = [];
  for (let index = tokens.length - 1; index >= 0 && label.length < 4; index -= 1) {
    const word = tokens[index] ?? "";
    const prev = tokens[index - 1] ?? "";
    if (prev === "/" || prev.endsWith("/")) break;
    if (!/^[\p{Lu}][\p{L}.'’-]*$/u.test(word)) break;
    label.unshift(word);
  }
  if (label.length === 0) return null;
  const text = label.join(" ");
  const start = before.lastIndexOf(text);
  if (start < 0) return null;
  return { label: text, start };
}

function readTitleValue(rest: string): string {
  const tokens = rest.split(/\s+/).filter(Boolean);
  const taken: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const bare = (tokens[index] ?? "").replace(/[.,;:]+$/g, "");
    if (!bare) continue;
    if (/^\d/.test(bare) && taken.length === 0) return bare;
    if (!/^[\p{Lu}]/u.test(bare)) break;
    const next = (tokens[index + 1] ?? "").replace(/[.,;:]+$/g, "");
    if (next && /^[\p{Ll}]/u.test(next)) break;
    taken.push(bare);
    if (taken.length >= 8) break;
  }
  return taken.join(" ");
}

function indexOfFold(haystack: string, needle: string): number {
  const trimmed = needle.trim();
  if (!trimmed) return -1;
  const exact = haystack.indexOf(trimmed);
  if (exact >= 0) return exact;
  const foldedHay = haystack.toLocaleLowerCase("tr");
  const foldedNeedle = trimmed.toLocaleLowerCase("tr");
  if (foldedHay.length !== haystack.length || foldedNeedle.length !== trimmed.length) return -1;
  return foldedHay.indexOf(foldedNeedle);
}

/**
 * Place a collapsed letter translation back onto the source regions.
 * Names, the reference number, the date, and the enclosure marker stay visible
 * in the paragraph even after the model joins every line.
 */
export function projectLetter(segments: SourceSegment[], translated: string): RenderBlock[] | null {
  const flat = translated.replace(/\s+/g, " ").trim();
  if (!flat || segments.length < 4) return null;
  const dateMatch = flat.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  if (!dateMatch || dateMatch.index == null) return null;
  const listMatch = LIST_WORD.exec(flat);
  const closingMatch = CLOSING_WORD.exec(flat.slice(0, listMatch?.index ?? flat.length));
  if (!closingMatch || closingMatch.index == null) return null;
  const closingAt = closingMatch.index;
  const listAt = listMatch?.index ?? flat.length;

  const signatureSegments = segments.filter((segment) => segment.role === "signature");
  const nameHits = signatureSegments
    .map((segment) => {
      const name = segment.text.split(/\n/)[0]?.trim() ?? "";
      const at = indexOfFold(flat, name);
      return { segment, name, at };
    })
    .filter((hit) => hit.at >= closingAt && hit.at < listAt)
    .sort((a, b) => a.at - b.at);
  if (signatureSegments.length > 0 && nameHits.length !== signatureSegments.length) return null;

  const city = flat.slice(Math.max(0, dateMatch.index - 40), dateMatch.index).match(/([\p{L}.'’-]+)\s*,\s*$/u);
  const dateStart = dateMatch.index - (city?.[0].length ?? 0);
  const logo = flat.slice(0, dateStart).trim();
  const dateText = flat.slice(dateStart, dateMatch.index + dateMatch[0].length).trim();
  const middle = flat.slice(dateMatch.index + dateMatch[0].length, closingAt).trim();
  const closing = closingMatch[0].trim();
  const tail = flat.slice(closingAt + closingMatch[0].length, listAt).trim();
  const listText = flat.slice(listAt).trim();

  const kvSegments = segments.filter((segment) => segment.role === "kv");
  const kvSpans: Array<{ start: number; end: number; label: string; value: string }> = [];
  for (const segment of kvSegments) {
    const value = segment.text.split(":").slice(1).join(":").trim();
    if (!/^\d/.test(value)) continue;
    const valueMatch = new RegExp(`:\\s*${escapeRegExp(value)}\\b`, "u").exec(middle);
    if (!valueMatch || valueMatch.index == null) continue;
    const label = labelBeforeColon(middle.slice(0, valueMatch.index));
    if (!label) continue;
    kvSpans.push({
      start: label.start,
      end: valueMatch.index + valueMatch[0].length,
      label: label.label,
      value,
    });
  }
  kvSpans.sort((a, b) => a.start - b.start);
  let cursor = kvSpans.at(-1)?.end ?? 0;
  const proseKv = kvSegments.filter((segment) => !/^\d/.test(segment.text.split(":").slice(1).join(":").trim()));
  for (let remaining = proseKv.length; remaining > 0; remaining -= 1) {
    const rest = middle.slice(cursor);
    const match = rest.match(/^\s*([A-Z][\p{L}.'’]*(?:\s+[A-Z][\p{L}.'’]*){0,3})\s*:\s*/u);
    if (!match || match.index == null || !match[1]) break;
    const value = readTitleValue(rest.slice(match.index + match[0].length));
    if (!value) break;
    const start = cursor + match.index;
    const end = cursor + match.index + match[0].length + rest.slice(match.index + match[0].length).indexOf(value) + value.length;
    kvSpans.push({ start, end, label: match[1].trim(), value });
    cursor = end;
  }
  kvSpans.sort((a, b) => a.start - b.start);
  if (kvSegments.length > 0 && kvSpans.length === 0) return null;

  const addressText = middle.slice(0, kvSpans[0]?.start ?? middle.length).trim();
  const bodyStart = kvSpans.at(-1)?.end ?? 0;
  const body = middle.slice(bodyStart).trim();
  if (!body || body.length < 40) return null;

  const addressSegments = segments.filter((segment) => segment.role === "address");
  const addressBlocks: RenderBlock[] = [];
  if (addressText) {
    const street = addressSegments[addressSegments.length - 1];
    const token = street?.text
      .split(/\s+/)
      .find((word) => word.length > 4 && indexOfFold(addressText, word) > 0);
    const splitAt = token ? indexOfFold(addressText, token) : -1;
    if (addressSegments.length > 1 && splitAt > 0) {
      addressBlocks.push({ type: "address", lines: [addressText.slice(0, splitAt).trim()], bold: true });
      addressBlocks.push({
        type: "address",
        lines: addressText
          .slice(splitAt)
          .split(/\s{2,}/)
          .map((line) => line.trim())
          .filter(Boolean),
      });
    } else {
      addressBlocks.push({ type: "address", lines: [addressText], bold: Boolean(addressSegments[0]?.bold) });
    }
  }

  const list = parseList(listText);
  if (segments.some((segment) => segment.role === "list") && (!list || list.items.length < 2)) return null;

  const blocks: RenderBlock[] = [];
  if (logo) blocks.push({ type: "logo", text: logo });
  blocks.push({ type: "paragraph", text: dateText, align: "left" });
  blocks.push(...addressBlocks);
  for (const span of kvSpans) blocks.push({ type: "kv", label: span.label, value: span.value });
  blocks.push({ type: "paragraph", text: body, align: "justify" });
  blocks.push({ type: "paragraph", text: closing.endsWith(",") ? closing : `${closing},`, align: "left" });

  if (nameHits.length) {
    const orgText = tail.slice(0, indexOfFold(tail, nameHits[0]?.name ?? "")).trim();
    const orgSegments = segments.filter((segment) => segment.role === "organization");
    if (orgText) {
      const preserved = orgSegments
        .map((segment) => segment.text.trim())
        .find((text) => text && indexOfFold(orgText, text) >= 0);
      if (preserved && orgSegments.length > 1) {
        const at = indexOfFold(orgText, preserved);
        const first = orgText.slice(at, at + preserved.length).trim();
        const second = `${orgText.slice(0, at)} ${orgText.slice(at + preserved.length)}`.trim();
        blocks.push({ type: "paragraph", text: first, bold: true, align: "left" });
        if (second) blocks.push({ type: "paragraph", text: second, align: "left" });
      } else {
        blocks.push({ type: "paragraph", text: orgText, bold: true, align: "left" });
      }
    }
    nameHits.forEach((hit, index) => {
      const next = nameHits[index + 1];
      const titleStart = indexOfFold(tail, hit.name) + hit.name.length;
      const titleEnd = next ? indexOfFold(tail, next.name) : tail.length;
      const title = tail.slice(titleStart, titleEnd).trim();
      blocks.push({
        type: "signature",
        electronic: false,
        column: hit.segment.column ?? (index === 0 ? "left" : "right"),
        lines: [`**${hit.name}**`, ...(title ? [title] : [])],
      });
    });
  }

  if (list) {
    blocks.push({ type: "list", ordered: true, label: list.label, items: list.items });
  }
  return blocks;
}

function parseList(text: string): { label: string; items: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const head = trimmed.match(/^(.*?)(?=\s*\d+\s*[).])/);
  const label = (head?.[1] ?? "Attachment").replace(/[:\s]+$/g, "") || "Attachment";
  const items = [...trimmed.matchAll(/\d+\s*[).]\s*([\s\S]*?)(?=\s*\d+\s*[).]|$)/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  if (items.length === 0) return null;
  return { label, items };
}

function partText(parts: Array<{ id: number; text: string }>, id: number): string {
  return parts.find((part) => part.id === id)?.text?.trim() ?? "";
}

/** Build render blocks from a part-by-part translation of the source regions. */
export function blocksFromSegmentTranslations(
  segments: SourceSegment[],
  parts: Array<{ id: number; text: string }>,
): RenderBlock[] | null {
  const blocks: RenderBlock[] = [];
  for (const segment of segments) {
    const text = partText(parts, segment.id);
    if (segment.role === "photo") {
      blocks.push({ type: "photo", caption: "Holder's photo" });
      continue;
    }
    if (!text) return null;
    if (segment.role === "logo") {
      blocks.push({ type: "logo", text: text.split("\n")[0]?.trim() || text });
      continue;
    }
    if (segment.role === "date" || segment.role === "closing") {
      blocks.push({ type: "paragraph", text: text.replace(/\s+/g, " "), align: "left" });
      continue;
    }
    if (segment.role === "organization") {
      blocks.push({ type: "paragraph", text: text.replace(/\s+/g, " "), align: "left", bold: segment.bold });
      continue;
    }
    if (segment.role === "body") {
      blocks.push({
        type: "paragraph",
        text: text.replace(/\s+/g, " "),
        align: segment.caps ? "center" : "justify",
        caps: segment.caps,
      });
      continue;
    }
    if (segment.role === "heading") {
      blocks.push({ type: "heading", text: text.replace(/\s+/g, " "), align: "center", bold: segment.bold, caps: segment.caps });
      continue;
    }
    if (segment.role === "address") {
      const addressLines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (addressLines.length === 0) return null;
      blocks.push({ type: "address", lines: addressLines, bold: segment.bold });
      continue;
    }
    if (segment.role === "kv" || segment.role === "box") {
      const match = text.replace(/\s+/g, " ").match(/^(.{1,60}?)\s*:\s*(\S.*)$/);
      if (!match?.[1] || !match[2]) return null;
      if (segment.role === "kv") blocks.push({ type: "kv", label: match[1].trim(), value: match[2].trim() });
      else blocks.push({ type: "box", label: match[1].trim(), value: match[2].trim(), column: segment.column });
      continue;
    }
    if (segment.role === "signature") {
      const signatureLines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (signatureLines.length === 0) return null;
      const [name, ...rest] = signatureLines;
      blocks.push({
        type: "signature",
        electronic: false,
        column: segment.column,
        lines: [`**${(name ?? "").replace(/^\*\*|\*\*$/g, "")}**`, ...rest],
      });
      continue;
    }
    if (segment.role === "list") {
      const list = parseList(text.includes("\n") ? text : text.replace(/\s+(?=\d+\s*[).])/g, "\n"));
      if (!list) return null;
      blocks.push({ type: "list", ordered: true, label: list.label, items: list.items });
    }
  }
  return blocks.length ? blocks : null;
}

export function ensurePortrait(blocks: RenderBlock[], portrait: boolean): RenderBlock[] {
  if (!portrait || blocks.some((block) => block.type === "photo") || !blocks.some((block) => block.type === "box")) return blocks;
  const next = [...blocks];
  const box = next.findIndex((block) => block.type === "box");
  next.splice(box + 1, 0, { type: "photo", caption: "Holder's photo" });
  return next;
}
