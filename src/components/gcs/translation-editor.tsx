"use client";

import type { GcsEditorPage } from "@/lib/gcs/editor-pages";
import type { PageKind, RenderBlock, SealAlign } from "@/lib/orders/pdf/layout";

const KINDS: Array<{ value: PageKind; label: string }> = [
  { value: "form", label: "Form" },
  { value: "certificate", label: "Certificate" },
  { value: "letter", label: "Letter" },
];

const POSITIONS: Array<{ value: SealAlign; label: string }> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

function fieldClass() {
  return "w-full rounded-lg border border-[#d5dbe6] bg-white px-2 py-1.5 text-[13px] text-ink";
}

function linkButtonClass() {
  return "text-[13px] font-semibold text-primary disabled:text-ink-muted";
}

function emptyTable(rows: number, columns: number, header = false): RenderBlock {
  return {
    type: "table",
    header,
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => "")),
  };
}

function columnCount(rows: string[][]): number {
  return Math.max(1, ...rows.map((row) => row.length));
}

function withWidth(rows: string[][], width: number): string[][] {
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

function fieldsToHorizontalTable(rows: Array<{ label: string; value: string }>): RenderBlock {
  const width = Math.max(1, rows.length);
  const labels = Array.from({ length: width }, (_, index) => rows[index]?.label ?? "");
  const values = Array.from({ length: width }, (_, index) => rows[index]?.value ?? "");
  return { type: "table", header: true, rows: [labels, values] };
}

function fieldsToTwoColumnTable(rows: Array<{ label: string; value: string }>): RenderBlock {
  const body = rows.length > 0 ? rows.map((row) => [row.label, row.value]) : [["", ""]];
  return { type: "table", header: false, rows: body };
}

export function TranslationEditor({
  pages,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  pages: GcsEditorPage[] | null;
  saving: boolean;
  error: string | null;
  onChange: (pages: GcsEditorPage[]) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  function updatePage(index: number, next: GcsEditorPage) {
    if (!pages) return;
    onChange(pages.map((page, pageIndex) => (pageIndex === index ? next : page)));
  }

  function updateBlock(pageIndex: number, blockIndex: number, block: RenderBlock) {
    const page = pages?.[pageIndex];
    if (!page) return;
    updatePage(pageIndex, {
      ...page,
      blocks: page.blocks.map((current, index) => (index === blockIndex ? block : current)),
    });
  }

  return (
    <div data-testid="translation-editor" className="flex min-h-0 flex-1 flex-col bg-[#f6f7f9]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-bg px-4 py-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#1f5eff]">GCS TRANSLATION</p>
          <h2 className="text-sm font-semibold text-ink">Edit translation</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-[34px] items-center rounded-[var(--cp-radius)] border border-line bg-bg px-3 text-[13px] font-semibold text-ink"
            onClick={onClose}
          >
            View PDF
          </button>
          <button
            type="button"
            data-testid="save-translation"
            className="inline-flex h-[34px] items-center rounded-[var(--cp-radius)] bg-primary px-3 text-[13px] font-semibold text-primary-ink disabled:opacity-60"
            disabled={saving || !pages || pages.length === 0}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save & Regenerate PDF"}
          </button>
        </div>
      </header>
      {error ? <p className="px-4 py-2 text-sm text-[#9f1239]">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {pages === null ? <p className="text-sm text-ink-muted">Loading the translation…</p> : null}
        {pages && pages.length === 0 ? (
          <p className="text-sm text-ink-muted">This translation has no editable pages yet.</p>
        ) : null}
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {pages?.map((page, pageIndex) => (
            <section key={`${page.documentId}-${page.pageNumber}`} className="rounded-2xl border border-line bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-[#e6ebf2] bg-[#fbfcfe] px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-[#5b6474]">GCS HEADER</p>
                  <h3 className="text-sm font-semibold">Page {page.combinedPageNumber}</h3>
                </div>
                <label className="text-[12px] font-semibold text-ink-muted">
                  Layout
                  <select
                    aria-label={`Layout for page ${page.combinedPageNumber}`}
                    className={`${fieldClass()} mt-1`}
                    value={page.kind ?? "form"}
                    onChange={(event) =>
                      updatePage(pageIndex, { ...page, kind: event.target.value as PageKind })
                    }
                  >
                    {KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-col gap-3 px-4 py-4">
                {page.blocks.map((block, blockIndex) => (
                  <BlockEditor
                    key={`${page.pageNumber}-${blockIndex}`}
                    block={block}
                    onChange={(next) => updateBlock(pageIndex, blockIndex, next)}
                  />
                ))}
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <button
                    type="button"
                    className={linkButtonClass()}
                    onClick={() =>
                      updatePage(pageIndex, {
                        ...page,
                        blocks: [...page.blocks, { type: "paragraph", text: "" }],
                      })
                    }
                  >
                    Add Paragraph
                  </button>
                  <button
                    type="button"
                    className={linkButtonClass()}
                    onClick={() =>
                      updatePage(pageIndex, {
                        ...page,
                        blocks: [...page.blocks, { type: "fields", rows: [{ label: "", value: "" }] }],
                      })
                    }
                  >
                    Add Fields
                  </button>
                  <button
                    type="button"
                    className={linkButtonClass()}
                    onClick={() =>
                      updatePage(pageIndex, {
                        ...page,
                        blocks: [...page.blocks, emptyTable(2, 3, true)],
                      })
                    }
                  >
                    Add Table
                  </button>
                  <button
                    type="button"
                    className={linkButtonClass()}
                    onClick={() =>
                      updatePage(pageIndex, {
                        ...page,
                        blocks: [...page.blocks, { type: "seal", text: "", column: "right" }],
                      })
                    }
                  >
                    Add [SEAL]
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlockEditor({ block, onChange }: { block: RenderBlock; onChange: (block: RenderBlock) => void }) {
  if (block.type === "heading" || block.type === "paragraph") {
    return (
      <label className="block text-[12px] font-semibold text-ink-muted">
        {block.type === "heading" ? "Heading" : "Paragraph"}
        <textarea
          className={`${fieldClass()} mt-1 min-h-16 font-normal`}
          value={block.text}
          onChange={(event) => onChange({ ...block, text: event.target.value })}
        />
      </label>
    );
  }
  if (block.type === "fields") {
    return (
      <fieldset className="rounded-xl border border-[#e6ebf2] p-3">
        <legend className="px-1 text-[12px] font-semibold text-ink-muted">Fields</legend>
        <div className="flex flex-col gap-2">
          {block.rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                aria-label={`Field label ${index + 1}`}
                className={fieldClass()}
                value={row.label}
                onChange={(event) => {
                  const rows = block.rows.map((current, rowIndex) =>
                    rowIndex === index ? { ...current, label: event.target.value } : current,
                  );
                  onChange({ ...block, rows });
                }}
              />
              <input
                aria-label={`Field value ${index + 1}`}
                className={fieldClass()}
                value={row.value}
                onChange={(event) => {
                  const rows = block.rows.map((current, rowIndex) =>
                    rowIndex === index ? { ...current, value: event.target.value } : current,
                  );
                  onChange({ ...block, rows });
                }}
              />
              <button
                type="button"
                className="text-[12px] font-semibold text-ink-muted"
                onClick={() => onChange({ ...block, rows: block.rows.filter((_, rowIndex) => rowIndex !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button
              type="button"
              className={linkButtonClass()}
              onClick={() => onChange({ ...block, rows: [...block.rows, { label: "", value: "" }] })}
            >
              Add field
            </button>
            <button type="button" className={linkButtonClass()} onClick={() => onChange(fieldsToHorizontalTable(block.rows))}>
              Convert to horizontal table
            </button>
            <button type="button" className={linkButtonClass()} onClick={() => onChange(fieldsToTwoColumnTable(block.rows))}>
              Convert to 2-col table
            </button>
          </div>
        </div>
      </fieldset>
    );
  }
  if (block.type === "kv") {
    return (
      <fieldset className="rounded-xl border border-[#e6ebf2] p-3">
        <legend className="px-1 text-[12px] font-semibold text-ink-muted">Label and value</legend>
        <div className="grid grid-cols-2 gap-2">
          <input
            aria-label="KV label"
            className={fieldClass()}
            value={block.label}
            onChange={(event) => onChange({ ...block, label: event.target.value })}
          />
          <input
            aria-label="KV value"
            className={fieldClass()}
            value={block.value}
            onChange={(event) => onChange({ ...block, value: event.target.value })}
          />
        </div>
      </fieldset>
    );
  }
  if (block.type === "signature") {
    return (
      <fieldset className="rounded-xl border border-[#e6ebf2] p-3">
        <legend className="px-1 text-[12px] font-semibold text-ink-muted">Signature</legend>
        <label className="block text-[12px] font-semibold text-ink-muted">
          Name and title
          <textarea
            aria-label="Signature lines"
            className={`${fieldClass()} mt-1 min-h-16 font-normal`}
            value={(block.lines ?? []).join("\n")}
            onChange={(event) => onChange({ ...block, lines: event.target.value.split("\n") })}
          />
        </label>
      </fieldset>
    );
  }
  if (block.type === "table") {
    return (
      <fieldset className="rounded-xl border border-[#e6ebf2] p-3">
        <legend className="px-1 text-[12px] font-semibold text-ink-muted">Table</legend>
        <div className="flex flex-col gap-2 overflow-x-auto">
          {block.rows.map((row, rowIndex) => (
            <div key={rowIndex} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, row.length)}, minmax(0, 1fr))` }}>
                {row.map((cell, cellIndex) => (
                  <input
                    key={cellIndex}
                    aria-label={`Row ${rowIndex + 1} column ${cellIndex + 1}`}
                    className={fieldClass()}
                    value={cell}
                    onChange={(event) => {
                      const rows = block.rows.map((current, index) =>
                        index === rowIndex
                          ? current.map((value, indexCell) => (indexCell === cellIndex ? event.target.value : value))
                          : current,
                      );
                      onChange({ ...block, rows });
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                className="pt-2 text-[12px] font-semibold text-ink-muted"
                onClick={() => onChange({ ...block, rows: block.rows.filter((_, index) => index !== rowIndex) })}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button
              type="button"
              className={linkButtonClass()}
              onClick={() => {
                const width = columnCount(block.rows);
                onChange({ ...block, rows: [...withWidth(block.rows, width), Array.from({ length: width }, () => "")] });
              }}
            >
              Add row
            </button>
            <button
              type="button"
              className={linkButtonClass()}
              onClick={() => onChange({ ...block, rows: withWidth(block.rows, columnCount(block.rows) + 1) })}
            >
              Add column
            </button>
            <button
              type="button"
              className={linkButtonClass()}
              disabled={columnCount(block.rows) <= 1}
              onClick={() => {
                const width = columnCount(block.rows);
                if (width <= 1) return;
                onChange({ ...block, rows: withWidth(block.rows, width - 1) });
              }}
            >
              Remove column
            </button>
          </div>
        </div>
      </fieldset>
    );
  }
  if (block.type === "seal") {
    const position = block.column ?? "right";
    return (
      <fieldset className="rounded-xl border border-[#e6ebf2] p-3">
        <legend className="px-1 text-[12px] font-semibold text-ink-muted">Seal</legend>
        <div className="flex flex-wrap items-center gap-4">
          <SealPreview text={block.text} position={position} />
          <div className="min-w-48 flex-1">
            <label className="block text-[12px] font-semibold text-ink-muted">
              Seal text
              <input
                className={`${fieldClass()} mt-1`}
                value={block.text}
                onChange={(event) => onChange({ ...block, text: event.target.value })}
              />
            </label>
            <label className="mt-2 block text-[12px] font-semibold text-ink-muted">
              Position
              <select
                aria-label="Seal position"
                className={`${fieldClass()} mt-1`}
                value={position}
                onChange={(event) => onChange({ ...block, column: event.target.value as SealAlign })}
              >
                {POSITIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </fieldset>
    );
  }
  return null;
}

function SealPreview({ text, position }: { text: string; position: SealAlign }) {
  const justify = position === "left" ? "justify-start" : position === "center" ? "justify-center" : "justify-end";
  return (
    <div className={`flex w-full max-w-[220px] ${justify}`} data-testid="seal-preview">
      <div className="grid h-24 w-24 place-items-center rounded-full border-2 border-[#1e293b] bg-white">
        <div className="grid h-[5.15rem] w-[5.15rem] place-items-center rounded-full border border-[#1e293b] px-2 text-center">
          <span>
            <span className="block text-[10px] font-bold tracking-wide text-[#1e293b]">[SEAL]</span>
            {text.trim() ? (
              <span className="mt-0.5 block text-[8px] leading-tight text-[#334155]">{text.trim()}</span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
