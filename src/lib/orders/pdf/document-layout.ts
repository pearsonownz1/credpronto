import type { BlockAlign, BlockColumn, RenderBlock, RenderPage } from "./layout";

export type PlanStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  serif?: boolean;
};

export type PlanText = {
  text: string;
  x: number;
  y: number;
  size: number;
  color: "ink" | "muted";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  serif?: boolean;
};

export type PlanRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  stroke: number;
};

export type PlanRule = { x1: number; y1: number; x2: number; y2: number; width: number };

export type DocumentPlan = {
  serif: boolean;
  /** Table grid lines. */
  rules?: PlanRule[];
  overflow: boolean;
  frame?: PlanRect;
  boxes: PlanRect[];
  image?: { x: number; y: number; w: number; h: number };
  texts: PlanText[];
};

type Measure = (text: string, size: number, style: PlanStyle) => number;

type Word = { text: string; bold: boolean; underline: boolean };

const NOTE_SIZE = 8;

export function documentKind(page: { kind?: RenderPage["kind"]; blocks?: RenderBlock[] }): "letter" | "certificate" | null {
  if (page.kind === "form") return null;
  if (page.kind === "letter" || page.kind === "certificate") return page.kind;
  const blocks = page.blocks ?? [];
  if (blocks.some((block) => block.type === "box" || block.type === "photo")) return "certificate";
  if (blocks.some((block) => block.type === "logo" || block.type === "address" || block.type === "list" || block.type === "kv")) {
    return "letter";
  }
  return null;
}

export function bracketNote(block: RenderBlock): string | null {
  if (block.type === "logo") return `[Logo: ${block.text.trim()}]`;
  if (block.type === "seal") return block.text.trim() ? `[Seal: ${block.text.trim()}]` : "[Seal]";
  if (block.type === "stamp") return block.text.trim() ? `[Stamp: ${block.text.trim()}]` : "[Stamp]";
  if (block.type === "signature") return block.electronic ? "[Electronic signature]" : "[Signature]";
  if (block.type === "handwritten") return block.text.trim() ? `[Handwritten: ${block.text.trim()}]` : "[Handwritten]";
  if (block.type === "illegible") return "[Illegible]";
  if (block.type === "photo") {
    const caption = (block.caption ?? "Holder's photo").trim().replace(/^\[/, "").replace(/\]$/, "");
    return `[${caption || "Holder's photo"}]`;
  }
  if (block.type === "note") return block.text;
  return null;
}

function columnOf(block: RenderBlock): BlockColumn {
  if ("column" in block && (block.column === "left" || block.column === "right" || block.column === "full")) {
    return block.column;
  }
  return "full";
}

function wordsOf(text: string): Word[] {
  const words: Word[] = [];
  let bold = false;
  let underline = false;
  let buf = "";
  const flush = () => {
    if (!buf) return;
    for (const part of buf.split(/\s+/)) {
      if (part) words.push({ text: part, bold, underline });
    }
    buf = "";
  };
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("**", index)) {
      flush();
      bold = !bold;
      index += 2;
      continue;
    }
    if (text.startsWith("__", index)) {
      flush();
      underline = !underline;
      index += 2;
      continue;
    }
    buf += text[index] ?? "";
    index += 1;
  }
  flush();
  return words;
}

function lineWidth(words: Word[], size: number, space: number, measure: Measure, serif: boolean): number {
  return words.reduce((sum, word, index) => sum + measure(word.text, size, { bold: word.bold, serif }) + (index > 0 ? space : 0), 0);
}

function wrapWords(words: Word[], size: number, maxWidth: number, measure: Measure, serif: boolean): Word[][] {
  const space = measure(" ", size, { serif });
  const lines: Word[][] = [];
  let line: Word[] = [];
  let width = 0;
  for (const word of words) {
    const wordWidth = measure(word.text, size, { bold: word.bold, serif });
    const next = line.length === 0 ? wordWidth : width + space + wordWidth;
    if (line.length > 0 && next > maxWidth) {
      lines.push(line);
      line = [word];
      width = wordWidth;
      continue;
    }
    line.push(word);
    width = next;
  }
  if (line.length) lines.push(line);
  return lines;
}

const TABLE_PAD = 3;

/** Column widths that fit the available width. Each column gets its natural width when it fits, otherwise wide columns shrink. */
export function tableColumnWidths(natural: number[], maxWidth: number, minWidth = 24): number[] {
  const count = natural.length;
  if (count === 0) return [];
  const floor = Math.min(minWidth, maxWidth / count);
  const wants = natural.map((width) => Math.max(floor, width));
  const total = wants.reduce((sum, width) => sum + width, 0);
  if (total <= maxWidth) {
    const extra = (maxWidth - total) / count;
    return wants.map((width) => width + extra);
  }
  let budget = maxWidth;
  let open = wants.map((_, index) => index);
  const out = wants.slice();
  // Columns narrower than an even share keep their width; wider ones split what is left.
  for (;;) {
    const share = budget / open.length;
    const small = open.filter((index) => (wants[index] ?? 0) <= share);
    if (small.length === 0 || small.length === open.length) {
      for (const index of open) out[index] = share;
      break;
    }
    for (const index of small) {
      out[index] = wants[index] ?? share;
      budget -= out[index] ?? 0;
    }
    open = open.filter((index) => !small.includes(index));
  }
  return out;
}

export type TableLayout = { texts: PlanText[]; rules: PlanRule[]; bottom: number; clipped: boolean };

/**
 * A grid with a bold header row, wrapped cells, and ruled borders.
 * Rows that would cross `bottom` are left off and the layout reports clipped.
 */
export function planTable(input: {
  rows: string[][];
  header: boolean;
  x: number;
  y: number;
  width: number;
  size: number;
  bottom: number;
  serif: boolean;
  measure: Measure;
}): TableLayout {
  const { size, serif, measure } = input;
  const columns = Math.max(0, ...input.rows.map((row) => row.length));
  const rows = input.rows.map((row) => Array.from({ length: columns }, (_, index) => (row[index] ?? "").trim()));
  const texts: PlanText[] = [];
  const rules: PlanRule[] = [];
  if (columns === 0 || rows.length === 0) return { texts, rules, bottom: input.y, clipped: false };
  const natural = Array.from({ length: columns }, (_, column) =>
    Math.max(...rows.map((row, rowIndex) => measure(row[column] ?? "", size, { serif, bold: input.header && rowIndex === 0 }))) + TABLE_PAD * 2,
  );
  const widths = tableColumnWidths(natural, input.width);
  const lefts: number[] = [];
  let cursor = input.x;
  for (const width of widths) {
    lefts.push(cursor);
    cursor += width;
  }
  const right = input.x + input.width;
  const leading = size * 1.22;
  let y = input.y;
  let clipped = false;
  const numeric = (text: string) => /^[\d\s.,/:%+-]+$/.test(text) && /\d/.test(text);
  rules.push({ x1: input.x, y1: y, x2: right, y2: y, width: 0.6 });
  rows.forEach((row, rowIndex) => {
    if (clipped) return;
    const bold = input.header && rowIndex === 0;
    const wrapped = row.map((cell, column) => {
      const words = wordsOf(cell).map((word) => ({ ...word, bold: word.bold || bold }));
      return wrapWords(words, size, Math.max(4, (widths[column] ?? 0) - TABLE_PAD * 2), measure, serif);
    });
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const height = lineCount * leading + TABLE_PAD * 2 - (leading - size);
    if (y - height < input.bottom) {
      clipped = true;
      return;
    }
    const space = measure(" ", size, { serif });
    wrapped.forEach((lines, column) => {
      const cellLeft = lefts[column] ?? input.x;
      const cellWidth = widths[column] ?? 0;
      const alignRight = !bold && numeric(row[column] ?? "");
      lines.forEach((line, lineIndex) => {
        const lineY = y - TABLE_PAD - size * 0.82 - lineIndex * leading;
        const natural = lineWidth(line, size, space, measure, serif);
        let wordX = alignRight ? cellLeft + cellWidth - TABLE_PAD - natural : cellLeft + TABLE_PAD;
        for (const word of line) {
          texts.push({ text: word.text, x: wordX, y: lineY, size, color: "ink", bold: word.bold, serif });
          wordX += measure(word.text, size, { bold: word.bold, serif }) + space;
        }
      });
    });
    y -= height;
    rules.push({ x1: input.x, y1: y, x2: right, y2: y, width: bold ? 0.9 : 0.4 });
  });
  const top = input.y;
  for (const [index, left] of [...lefts, right].entries()) {
    rules.push({ x1: left, y1: top, x2: left, y2: y, width: index === 0 || index === lefts.length ? 0.6 : 0.4 });
  }
  return { texts, rules, bottom: y, clipped };
}

/** Words placed on the page. Text that falls below the page is left out. */
export function paintedPlanText(plan: DocumentPlan, minY = 12): string {
  return plan.texts
    .filter((item) => item.y >= minY)
    .map((item) => item.text)
    .join(" ");
}

export function planDocument(input: {
  kind: "letter" | "certificate";
  blocks: RenderBlock[];
  width: number;
  height: number;
  footer: number;
  size: number;
  measure: Measure;
  hasPhoto: boolean;
  /** Pushes letter and certificate text down so a letterhead can sit above it. */
  topInset?: number;
}): DocumentPlan {
  if (input.kind === "certificate") return planCertificate(input);
  return planLetter(input);
}

function planLetter(input: {
  blocks: RenderBlock[];
  width: number;
  height: number;
  footer: number;
  size: number;
  measure: Measure;
  topInset?: number;
}): DocumentPlan {
  const margin = Math.max(54, Math.min(68, input.width * 0.09));
  const maxWidth = input.width - margin * 2;
  const texts: PlanText[] = [];
  const rules: PlanRule[] = [];
  let y = input.height - margin - (input.topInset ?? 0);
  const serif = false;
  const size = input.size;
  const leading = size * 1.38;

  const paintWords = (
    words: Word[],
    x: number,
    width: number,
    fontSize: number,
    align: BlockAlign,
    color: "ink" | "muted",
  ) => {
    const lines = wrapWords(words, fontSize, width, input.measure, serif);
    const space = input.measure(" ", fontSize, { serif });
    lines.forEach((line, lineIndex) => {
      const natural = lineWidth(line, fontSize, space, input.measure, serif);
      const gaps = Math.max(0, line.length - 1);
      const last = lineIndex === lines.length - 1;
      const justify = align === "justify" && !last && line.length > 4 && width - natural < width * 0.15;
      const gap = justify ? (width - (natural - space * gaps)) / gaps : space;
      let cursor = x;
      if (align === "center") cursor = x + Math.max(0, (width - natural) / 2);
      if (align === "right") cursor = x + Math.max(0, width - natural);
      for (const word of line) {
        texts.push({
          text: word.text,
          x: cursor,
          y,
          size: fontSize,
          color,
          bold: word.bold,
          underline: word.underline,
          serif,
        });
        cursor += input.measure(word.text, fontSize, { bold: word.bold, serif }) + gap;
      }
      y -= fontSize * 1.38;
    });
  };

  const paintText = (text: string, x: number, width: number, fontSize: number, align: BlockAlign, color: "ink" | "muted", bold = false) => {
    const words = wordsOf(text).map((word) => ({ ...word, bold: word.bold || bold }));
    if (words.length === 0) return;
    paintWords(words, x, width, fontSize, align, color);
  };

  const paintNote = (text: string) => {
    paintText(text, margin, maxWidth, NOTE_SIZE, "left", "muted");
    y -= 6;
  };

  const paintSignature = (block: Extract<RenderBlock, { type: "signature" }>, x: number, width: number) => {
    const start = y;
    paintText(bracketNote(block) ?? "[Signature]", x, width, NOTE_SIZE, "left", "muted");
    y -= 2;
    for (const line of block.lines ?? []) {
      paintText(line, x, width, size, "left", "ink");
      y -= 1;
    }
    return start - y;
  };

  const blocks = input.blocks;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const next = blocks[index + 1];
    if (!block) continue;
    if (
      block.type === "signature" &&
      columnOf(block) === "left" &&
      next?.type === "signature" &&
      columnOf(next) === "right"
    ) {
      const gap = 28;
      const col = (maxWidth - gap) / 2;
      const saved = y;
      paintSignature(block, margin, col);
      const leftY = y;
      y = saved;
      paintSignature(next, margin + col + gap, col);
      y = Math.min(leftY, y) - 8;
      index += 1;
      continue;
    }

    if (block.type === "logo" || block.type === "seal" || block.type === "stamp" || block.type === "handwritten" || block.type === "illegible" || block.type === "note") {
      paintNote(bracketNote(block) ?? "");
      continue;
    }
    if (block.type === "signature") {
      paintSignature(block, margin, maxWidth);
      y -= 6;
      continue;
    }
    if (block.type === "heading") {
      const fontSize = block.level === 2 ? size : size + 1;
      paintText(block.text, margin, maxWidth, fontSize, block.align ?? "left", "ink", block.bold ?? block.level !== 2);
      y -= 4;
      continue;
    }
    if (block.type === "address") {
      for (const line of block.lines) paintText(line, margin, maxWidth, size, block.align ?? "left", "ink", Boolean(block.bold));
      y -= 8;
      continue;
    }
    if (block.type === "kv") {
      const group: Array<Extract<RenderBlock, { type: "kv" }>> = [block];
      while (blocks[index + 1]?.type === "kv") {
        const follow = blocks[index + 1];
        if (follow?.type === "kv") group.push(follow);
        index += 1;
      }
      const labelWidth = Math.max(
        ...group.map((item) => input.measure(item.label, size, { bold: item.bold, serif })),
        input.measure("Subject", size, { serif }),
      );
      for (const item of group) {
        texts.push({ text: item.label, x: margin, y, size, color: "ink", bold: item.bold, serif });
        const colonX = margin + labelWidth + 10;
        texts.push({ text: ":", x: colonX, y, size, color: "ink", serif });
        texts.push({
          text: item.value,
          x: colonX + input.measure(": ", size, { serif }),
          y,
          size,
          color: "ink",
          serif,
        });
        y -= leading;
      }
      y -= 6;
      continue;
    }
    if (block.type === "list") {
      if (block.label) {
        paintText(block.label, margin, maxWidth, size, "left", "ink", true);
        y -= 2;
      }
      const items = block.items.filter((item) => item.trim());
      const numberWidth = input.measure("6) ", size, { serif });
      items.forEach((item, itemIndex) => {
        const prefix = block.ordered === false ? "• " : `${itemIndex + 1}) `;
        const saved = y;
        texts.push({ text: prefix.trimEnd(), x: margin, y, size, color: "ink", serif });
        const body = wordsOf(item);
        paintWords(body, margin + numberWidth, maxWidth - numberWidth, size, "left", "ink");
        if (y === saved) y -= leading;
        y -= 1;
      });
      y -= 4;
      continue;
    }
    if (block.type === "paragraph") {
      paintText(block.text, margin, maxWidth, size, block.align ?? "left", "ink", Boolean(block.bold));
      y -= block.align === "justify" ? 8 : 6;
      continue;
    }
    if (block.type === "photo") {
      paintNote(bracketNote(block) ?? "[Holder's photo]");
      continue;
    }
    if (block.type === "box") {
      paintText(`${block.label} ${block.value}`, margin, maxWidth, size, "left", "ink", true);
      y -= 4;
      continue;
    }
    if (block.type === "fields") {
      for (const row of block.rows) {
        paintText(`${row.label}: ${row.value}`, margin, maxWidth, size, "left", "ink");
      }
      y -= 4;
      continue;
    }
    if (block.type === "table") {
      const table = planTable({
        rows: block.rows,
        header: block.header ?? true,
        x: margin,
        y,
        width: maxWidth,
        size: size - 1,
        bottom: input.footer,
        serif,
        measure: input.measure,
      });
      texts.push(...table.texts);
      rules.push(...table.rules);
      y = table.bottom - 8;
      if (table.clipped) y = Math.min(y, input.footer - 1);
    }
  }

  return { serif, overflow: y < input.footer, boxes: [], texts, rules };
}

/**
 * A birth certificate stored as a certificate is a stack of labeled fields.
 * The license planner paints headings and prose only, so those field values
 * never reach the page. This planner keeps each value on the line with its label.
 */
function planLabeledCertificate(input: {
  blocks: RenderBlock[];
  width: number;
  height: number;
  footer: number;
  size: number;
  measure: Measure;
  topInset?: number;
}): DocumentPlan {
  const texts: PlanText[] = [];
  const rules: PlanRule[] = [];
  const serif = true;
  const size = input.size;
  const inset = 26;
  const frame: PlanRect = {
    x: inset,
    y: input.footer + 6,
    w: input.width - inset * 2,
    h: input.height - input.footer - 6 - 22 - (input.topInset ?? 0),
    radius: 18,
    stroke: 1.6,
  };
  const left = frame.x + 22;
  const innerW = frame.w - 44;
  let y = frame.y + frame.h - 22;
  const bottom = frame.y + 12;
  let clipped = false;

  const paintLine = (text: string, fontSize: number, align: BlockAlign, bold = false, color: "ink" | "muted" = "ink") => {
    const words = wordsOf(text).map((word) => ({ ...word, bold: word.bold || bold }));
    if (words.length === 0) return;
    const lines = wrapWords(words, fontSize, innerW, input.measure, serif);
    const space = input.measure(" ", fontSize, { serif, bold });
    for (const line of lines) {
      if (y < bottom) clipped = true;
      const natural = lineWidth(line, fontSize, space, input.measure, serif);
      let cursor = left;
      if (align === "center") cursor = left + Math.max(0, (innerW - natural) / 2);
      if (align === "right") cursor = left + Math.max(0, innerW - natural);
      for (const word of line) {
        texts.push({
          text: word.text,
          x: cursor,
          y,
          size: fontSize,
          color,
          bold: word.bold,
          underline: word.underline,
          serif,
        });
        cursor += input.measure(word.text, fontSize, { bold: word.bold, serif }) + space;
      }
      y -= fontSize * 1.22;
    }
  };

  const paintPair = (label: string, value: string, bold = false) => {
    const name = label.trim();
    const printed = value.trim();
    paintLine(printed ? `${name}: ${printed}` : name, size, "left", bold);
    y -= 1;
  };

  for (const block of input.blocks) {
    if (y < bottom) {
      clipped = true;
      break;
    }
    if (block.type === "heading") {
      const prominent = Boolean(block.bold) || block.level === 1;
      paintLine(block.text, prominent ? size + 1.5 : size, "center", prominent);
      y -= 2;
      continue;
    }
    if (block.type === "kv") {
      paintPair(block.label, block.value, Boolean(block.bold));
      continue;
    }
    if (block.type === "box") {
      paintPair(block.label, block.value, true);
      continue;
    }
    if (block.type === "fields") {
      for (const row of block.rows) {
        if (y < bottom) clipped = true;
        paintPair(row.label, row.value);
      }
      y -= 2;
      continue;
    }
    if (block.type === "paragraph") {
      paintLine(block.text, size, block.align === "center" || block.caps ? "center" : "left", Boolean(block.bold));
      y -= 3;
      continue;
    }
    if (block.type === "address") {
      for (const line of block.lines) paintLine(line, size, block.align ?? "left", Boolean(block.bold));
      y -= 2;
      continue;
    }
    if (block.type === "list") {
      if (block.label) paintLine(block.label, size, "left", true);
      block.items.forEach((item, index) => {
        const prefix = block.ordered === false ? "•" : `${index + 1})`;
        paintLine(`${prefix} ${item}`, size, "left");
      });
      y -= 2;
      continue;
    }
    if (block.type === "table") {
      const table = planTable({
        rows: block.rows,
        header: block.header ?? true,
        x: left,
        y: y + size * 0.6,
        width: innerW,
        size: size - 1,
        bottom,
        serif,
        measure: input.measure,
      });
      texts.push(...table.texts);
      rules.push(...table.rules);
      if (table.clipped) clipped = true;
      y = table.bottom - size - 4;
      continue;
    }
    if (block.type === "signature") {
      const note = bracketNote(block);
      if (note) paintLine(note, NOTE_SIZE, "right", false, "muted");
      for (const line of block.lines ?? []) paintLine(line, size - 0.5, "right", true);
      y -= 3;
      continue;
    }
    const note = bracketNote(block);
    if (note) {
      paintLine(note, NOTE_SIZE, "left", false, "muted");
      y -= 1;
    }
  }

  const lowest = texts.reduce((min, item) => Math.min(min, item.y), y);
  return {
    serif,
    overflow: clipped || lowest < input.footer + 2 || y < frame.y + 8,
    frame,
    boxes: [],
    texts,
    rules,
  };
}

function planCertificate(input: {
  blocks: RenderBlock[];
  width: number;
  height: number;
  footer: number;
  size: number;
  measure: Measure;
  hasPhoto: boolean;
  topInset?: number;
}): DocumentPlan {
  if (input.blocks.some((block) => block.type === "kv" || block.type === "fields" || block.type === "table")) {
    return planLabeledCertificate(input);
  }
  const texts: PlanText[] = [];
  const boxes: PlanRect[] = [];
  const serif = true;
  const size = input.size;
  const inset = 26;
  const frame: PlanRect = {
    x: inset,
    y: input.footer + 6,
    w: input.width - inset * 2,
    h: input.height - input.footer - 6 - 22 - (input.topInset ?? 0),
    radius: 18,
    stroke: 1.6,
  };
  const left = frame.x + 28;
  const right = frame.x + frame.w - 28;
  const innerW = right - left;
  let y = frame.y + frame.h - 32;

  const paintLine = (text: string, x: number, width: number, fontSize: number, align: BlockAlign, bold = false, color: "ink" | "muted" = "ink") => {
    const words = wordsOf(text).map((word) => ({ ...word, bold: word.bold || bold }));
    const lines = wrapWords(words, fontSize, width, input.measure, serif);
    const space = input.measure(" ", fontSize, { serif, bold });
    for (const line of lines) {
      const natural = lineWidth(line, fontSize, space, input.measure, serif);
      let cursor = x;
      if (align === "center") cursor = x + Math.max(0, (width - natural) / 2);
      if (align === "right") cursor = x + Math.max(0, width - natural);
      for (const word of line) {
        texts.push({
          text: word.text,
          x: cursor,
          y,
          size: fontSize,
          color,
          bold: word.bold,
          underline: word.underline,
          serif,
        });
        cursor += input.measure(word.text, fontSize, { bold: word.bold, serif }) + space;
      }
      y -= fontSize * 1.32;
    }
  };

  const headings = input.blocks.filter((block) => block.type === "heading");
  headings.forEach((block, index) => {
    if (block.type !== "heading") return;
    const main = block.bold || index === headings.length - 1;
    paintLine(block.text, left, innerW, main ? size + 2 : size + 0.5, "center", main);
    y -= main ? 8 : 2;
  });
  y -= 6;

  const boxBlocks = input.blocks.filter((block) => block.type === "box");
  const leftBox = boxBlocks.find((block) => block.type === "box" && columnOf(block) === "left") ?? boxBlocks[0];
  const rightBox = boxBlocks.find((block) => block.type === "box" && columnOf(block) === "right") ?? boxBlocks[1];
  const seals = input.blocks.filter((block) => block.type === "seal");
  const leftSeal = seals.find((block) => columnOf(block) === "left") ?? seals[0];
  const rightSeal = seals.find((block) => columnOf(block) === "right") ?? seals[1];
  const photo = input.blocks.find((block) => block.type === "photo");
  const photoW = 92;
  const photoH = input.hasPhoto ? 122 : 0;
  const caption = photo ? bracketNote(photo) ?? "[Holder's photo]" : "";
  const captionSize = NOTE_SIZE;
  const rowH = Math.max(photoH + (caption ? 16 : 0), 52);
  const rowTop = y;
  const centerX = left + innerW / 2;

  const placeBox = (block: RenderBlock | undefined, side: "left" | "right") => {
    if (!block || block.type !== "box") return;
    const labelSize = 8;
    const valueSize = size;
    const labelW = input.measure(block.label, labelSize, { serif });
    const valueW = input.measure(block.value, valueSize, { serif, bold: true });
    const boxW = Math.min(150, Math.max(108, labelW + 18, valueW + 18));
    const boxH = 44;
    const boxX = side === "left" ? left + 62 : right - 62 - boxW;
    const boxY = rowTop - rowH / 2 - boxH / 2;
    boxes.push({ x: boxX, y: boxY, w: boxW, h: boxH, radius: 4, stroke: 1.1 });
    const labelX = boxX + (boxW - labelW) / 2;
    const valueX = boxX + (boxW - valueW) / 2;
    texts.push({ text: block.label, x: labelX, y: boxY + 27, size: labelSize, color: "ink", serif });
    texts.push({ text: block.value, x: valueX, y: boxY + 12, size: valueSize, color: "ink", bold: true, serif });
  };
  placeBox(leftBox, "left");
  placeBox(rightBox, "right");

  const placeSeal = (block: RenderBlock | undefined, side: "left" | "right") => {
    if (!block) return;
    const note = bracketNote(block) ?? "[Seal]";
    const width = input.measure(note, NOTE_SIZE, { serif });
    const x = side === "left" ? left : right - width;
    texts.push({ text: note, x, y: rowTop - 18, size: NOTE_SIZE, color: "muted", serif });
  };
  placeSeal(leftSeal, "left");
  placeSeal(rightSeal, "right");

  let image: DocumentPlan["image"];
  if (photo) {
    const imageX = centerX - photoW / 2;
    const imageBottom = rowTop - photoH;
    if (input.hasPhoto) image = { x: imageX, y: imageBottom, w: photoW, h: photoH };
    const capW = input.measure(caption, captionSize, { serif });
    texts.push({
      text: caption,
      x: centerX - capW / 2,
      y: (input.hasPhoto ? imageBottom : rowTop - 8) - 14,
      size: captionSize,
      color: "muted",
      serif,
    });
  }
  y = rowTop - rowH - 16;

  const signatures = input.blocks.filter((block) => block.type === "signature");
  const signature = signatures.find((block) => columnOf(block) === "right") ?? signatures[0];
  const signWidth = Math.min(240, innerW * 0.42);
  const signX = right - signWidth;
  const signLines = signature && signature.type === "signature" ? signature.lines ?? [] : [];
  const signNote = signature ? bracketNote(signature) ?? "[Signature]" : "";
  const signHeight =
    (signNote ? NOTE_SIZE * 1.4 : 0) +
    signLines.length * size * 1.3 +
    8;
  const signTop = frame.y + 22 + signHeight;
  const bodyBottom = signTop + 12;

  const body = input.blocks.filter(
    (block) => block.type === "paragraph" || block.type === "list" || block.type === "address" || block.type === "kv",
  );
  for (const block of body) {
    if (y < bodyBottom) break;
    if (block.type === "paragraph") {
      const align = block.align ?? (block.caps ? "center" : "justify");
      const words = wordsOf(block.text).map((word) => ({ ...word, bold: word.bold || Boolean(block.bold) }));
      const lines = wrapWords(words, size, innerW - 36, input.measure, serif);
      const space = input.measure(" ", size, { serif });
      const blockLeft = left + 18;
      const blockWidth = innerW - 36;
      for (const line of lines) {
        if (y < bodyBottom) break;
        const natural = lineWidth(line, size, space, input.measure, serif);
        let cursor = blockLeft;
        if (align === "center") cursor = blockLeft + Math.max(0, (blockWidth - natural) / 2);
        if (align === "right") cursor = blockLeft + Math.max(0, blockWidth - natural);
        const justify = align === "justify" && line !== lines[lines.length - 1] && line.length > 4 && blockWidth - natural < blockWidth * 0.15;
        const gaps = Math.max(1, line.length - 1);
        const gap = justify ? (blockWidth - (natural - space * (line.length - 1))) / gaps : space;
        for (const word of line) {
          texts.push({ text: word.text, x: cursor, y, size, color: "ink", bold: word.bold, underline: word.underline, serif });
          cursor += input.measure(word.text, size, { bold: word.bold, serif }) + gap;
        }
        y -= size * 1.38;
      }
      y -= 8;
    }
  }

  if (signature && signature.type === "signature") {
    let signY = frame.y + 24 + signLines.length * size * 1.28 + (signNote ? 14 : 0);
    if (signNote) {
      const noteW = input.measure(signNote, NOTE_SIZE, { serif });
      texts.push({ text: signNote, x: signX + signWidth - noteW, y: signY, size: NOTE_SIZE, color: "muted", serif });
      signY -= 14;
    }
    for (const line of signLines) {
      const words = wordsOf(line);
      const bold = words.some((word) => word.bold) || line === signLines[0];
      const plain = words.map((word) => word.text).join(" ");
      const width = input.measure(plain, size - 0.5, { serif, bold });
      texts.push({
        text: plain,
        x: signX + signWidth - width,
        y: signY,
        size: size - 0.5,
        color: "ink",
        bold,
        serif,
      });
      signY -= size * 1.25;
    }
  }

  const lowest = texts.reduce((min, item) => Math.min(min, item.y), y);
  return {
    serif,
    overflow: lowest < input.footer + 2 || y < frame.y + 8,
    frame,
    boxes,
    image,
    texts,
  };
}
