import { normalizedPageSize, pageKind, sealAlign, type PageKind, type RenderBlock } from "@/lib/orders/pdf/layout";
import { blocksToParagraphs } from "@/lib/orders/pdf/structure";

export type GcsEditorPage = {
  documentId: string;
  pageNumber: number;
  combinedPageNumber: number;
  widthPt: number;
  heightPt: number;
  kind: PageKind | null;
  blocks: RenderBlock[];
  paragraphs: string[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" ? [item] : []));
}

function blockColumn(value: unknown): "left" | "right" | "full" | undefined {
  return value === "left" || value === "right" || value === "full" ? value : undefined;
}

function align(value: unknown): "left" | "center" | "right" | "justify" | undefined {
  return value === "left" || value === "center" || value === "right" || value === "justify" ? value : undefined;
}

/** Keep an edited block in the shape the PDF renderer understands. */
export function sanitizeEditorBlock(value: unknown): RenderBlock | null {
  if (!value || typeof value !== "object") return null;
  const block = value as Record<string, unknown>;
  const type = block.type;
  if (type === "heading") {
    const heading = text(block.text).trim();
    if (!heading) return null;
    return {
      type: "heading",
      text: heading,
      level: block.level === 2 ? 2 : 1,
      align: align(block.align),
      bold: block.bold === true ? true : undefined,
      caps: block.caps === true ? true : undefined,
    };
  }
  if (type === "paragraph") {
    const paragraph = text(block.text).trim();
    if (!paragraph) return null;
    return {
      type: "paragraph",
      text: paragraph,
      align: align(block.align),
      bold: block.bold === true ? true : undefined,
      underline: block.underline === true ? true : undefined,
      caps: block.caps === true ? true : undefined,
    };
  }
  if (type === "fields" && Array.isArray(block.rows)) {
    const rows = block.rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as { label?: unknown; value?: unknown };
      const label = text(record.label).trim();
      const valueText = text(record.value).trim();
      if (!label && !valueText) return [];
      return [{ label, value: valueText }];
    });
    if (rows.length === 0) return null;
    return { type: "fields", rows };
  }
  if (type === "table" && Array.isArray(block.rows)) {
    const rows = block.rows.flatMap((row) => (Array.isArray(row) ? [row.map((cell) => text(cell))] : []));
    if (rows.length === 0) return null;
    return { type: "table", rows, header: block.header !== false };
  }
  if (type === "seal") {
    const column = sealAlign(block.column);
    return { type: "seal", text: text(block.text).trim(), ...(column ? { column } : {}) };
  }
  if (type === "note") {
    const note = text(block.text).trim();
    return note ? { type: "note", text: note } : null;
  }
  if (type === "kv") {
    return { type: "kv", label: text(block.label).trim(), value: text(block.value).trim(), bold: block.bold === true };
  }
  if (type === "address") {
    const lines = stringList(block.lines).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return { type: "address", lines, align: align(block.align), ...(block.bold === true ? { bold: true } : {}) };
  }
  if (type === "signature") {
    const column = blockColumn(block.column);
    const lines = stringList(block.lines);
    return {
      type: "signature",
      electronic: block.electronic === true,
      ...(column ? { column } : {}),
      ...(lines.length ? { lines } : {}),
    };
  }
  if (type === "stamp") {
    const stamp = text(block.text).trim();
    if (!stamp) return null;
    const column = blockColumn(block.column);
    return { type: "stamp", text: stamp, ...(column ? { column } : {}) };
  }
  if (type === "logo") {
    const logo = text(block.text).trim();
    return logo ? { type: "logo", text: logo } : null;
  }
  if (type === "photo") {
    const caption = text(block.caption).trim();
    return caption ? { type: "photo", caption } : { type: "photo" };
  }
  if (type === "box") {
    const column = blockColumn(block.column);
    return {
      type: "box",
      label: text(block.label).trim(),
      value: text(block.value).trim(),
      ...(column ? { column } : {}),
    };
  }
  if (type === "list") {
    const items = stringList(block.items).map((item) => item.trim()).filter(Boolean);
    if (items.length === 0) return null;
    const label = text(block.label).trim();
    return { type: "list", items, ...(block.ordered === true ? { ordered: true } : {}), ...(label ? { label } : {}) };
  }
  if (type === "handwritten") {
    const handwritten = text(block.text).trim();
    return handwritten ? { type: "handwritten", text: handwritten } : null;
  }
  if (type === "illegible") return { type: "illegible" };
  return null;
}

export function sanitizeEditorPages(value: unknown): GcsEditorPage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const pages: GcsEditorPage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const page = entry as Record<string, unknown>;
    const documentId = text(page.documentId).trim();
    const pageNumber = page.pageNumber;
    const combinedPageNumber = page.combinedPageNumber;
    if (!documentId || typeof pageNumber !== "number" || typeof combinedPageNumber !== "number") return null;
    const blocks = Array.isArray(page.blocks) ? page.blocks.flatMap((block) => {
      const sanitized = sanitizeEditorBlock(block);
      return sanitized ? [sanitized] : [];
    }) : [];
    const kept = blocks.length > 0 ? blocks : ([{ type: "paragraph", text: " " }] as RenderBlock[]);
    const kind = pageKind(page.kind) ?? null;
    const size = normalizedPageSize(
      typeof page.widthPt === "number" ? page.widthPt : 0,
      typeof page.heightPt === "number" ? page.heightPt : 0,
    );
    pages.push({
      documentId,
      pageNumber,
      combinedPageNumber,
      widthPt: size.widthPt,
      heightPt: size.heightPt,
      kind,
      blocks: kept,
      paragraphs: blocksToParagraphs(kept),
    });
  }
  return pages;
}

type StoredTranslation = {
  id: string;
  documentId: string;
  version: number;
  output: unknown;
};

type SourcePage = {
  documentId: string;
  pageNumber: number;
  widthPt: number | null;
  heightPt: number | null;
  combinedPageNumber: number;
};

function blocksFromStored(page: Record<string, unknown>): RenderBlock[] {
  if (Array.isArray(page.blocks)) {
    const blocks = page.blocks.flatMap((block) => {
      const sanitized = sanitizeEditorBlock(block);
      return sanitized ? [sanitized] : [];
    });
    if (blocks.length > 0) return blocks;
  }
  const paragraphs = Array.isArray(page.paragraphs)
    ? page.paragraphs.flatMap((item) => {
        if (typeof item === "string" && item.trim()) return [item];
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
          const line = (item as { text: string }).text.trim();
          return line ? [line] : [];
        }
        return [];
      })
    : [];
  if (paragraphs.length > 0) return paragraphs.map((paragraph) => ({ type: "paragraph" as const, text: paragraph }));
  return [{ type: "paragraph", text: " " }];
}

/** Latest translation output for each document, in combined page order. */
export function editorPagesFromTranslations(input: {
  translations: StoredTranslation[];
  sourcePages: SourcePage[];
}): GcsEditorPage[] {
  const latest = new Map<string, StoredTranslation>();
  for (const translation of input.translations) {
    const current = latest.get(translation.documentId);
    if (!current || translation.version >= current.version) latest.set(translation.documentId, translation);
  }
  const pages: GcsEditorPage[] = [];
  for (const translation of latest.values()) {
    const output = translation.output;
    const stored = output && typeof output === "object" && Array.isArray((output as { pages?: unknown }).pages)
      ? ((output as { pages: unknown[] }).pages)
      : [];
    stored.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const page = entry as Record<string, unknown>;
      const pageNumber = typeof page.pageNumber === "number" ? page.pageNumber : index + 1;
      const source = input.sourcePages.find(
        (item) => item.documentId === translation.documentId && item.pageNumber === pageNumber,
      );
      const blocks = blocksFromStored(page);
      const size = normalizedPageSize(source?.widthPt ?? 0, source?.heightPt ?? 0);
      pages.push({
        documentId: translation.documentId,
        pageNumber,
        combinedPageNumber:
          typeof page.combinedPageNumber === "number" ? page.combinedPageNumber : source?.combinedPageNumber ?? pages.length + 1,
        widthPt: size.widthPt,
        heightPt: size.heightPt,
        kind: pageKind(page.kind) ?? null,
        blocks,
        paragraphs: blocksToParagraphs(blocks),
      });
    });
  }
  return pages.sort((a, b) => a.combinedPageNumber - b.combinedPageNumber || a.pageNumber - b.pageNumber);
}

/** Write edited blocks back onto each document's translation output. */
export function outputsAfterEdit(
  translations: StoredTranslation[],
  edited: GcsEditorPage[],
): Array<{ id: string; output: unknown }> {
  const latest = new Map<string, StoredTranslation>();
  for (const translation of translations) {
    const current = latest.get(translation.documentId);
    if (!current || translation.version >= current.version) latest.set(translation.documentId, translation);
  }
  const updates: Array<{ id: string; output: unknown }> = [];
  for (const translation of latest.values()) {
    const output = translation.output;
    const record = output && typeof output === "object" ? { ...(output as Record<string, unknown>) } : {};
    const stored = Array.isArray(record.pages) ? record.pages : [];
    const pages = stored.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const page = entry as Record<string, unknown>;
      const pageNumber = typeof page.pageNumber === "number" ? page.pageNumber : null;
      const match = edited.find((item) => item.documentId === translation.documentId && item.pageNumber === pageNumber);
      if (!match) return entry;
      const next: Record<string, unknown> = {
        ...page,
        blocks: match.blocks,
        paragraphs: blocksToParagraphs(match.blocks),
        combinedPageNumber: match.combinedPageNumber,
      };
      if (match.kind) next.kind = match.kind;
      else delete next.kind;
      return next;
    });
    updates.push({ id: translation.id, output: { ...record, pages } });
  }
  return updates;
}
