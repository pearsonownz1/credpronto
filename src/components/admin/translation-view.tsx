"use client";

import { useRef, useState } from "react";
import type { StaffPage } from "@/lib/api/types";
import { segmentMismatchWarning, translationLines } from "@/components/admin/translation-lines";

const ROW =
  "grid grid-cols-2 items-stretch outline-none hover:bg-[var(--cp-blue-l)] focus:bg-[var(--cp-blue-l)] focus-visible:bg-[var(--cp-blue-l)] focus-within:bg-[var(--cp-blue-l)]";

type Edit = { pageId: string; index: number; value: string };

export function TranslationView({
  pages,
  drafts,
  canEdit,
  onCommit,
}: {
  pages: StaffPage[];
  drafts: Record<string, string[]>;
  canEdit: boolean;
  onCommit: (pageId: string, index: number, value: string) => void;
}) {
  const [editing, setEditing] = useState<Edit | null>(null);
  const editingRef = useRef<Edit | null>(null);

  function begin(pageId: string, index: number, value: string) {
    if (!canEdit) return;
    if (editingRef.current?.pageId === pageId && editingRef.current.index === index) return;
    const next = { pageId, index, value };
    editingRef.current = next;
    setEditing(next);
  }

  function finish(commit: boolean) {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    setEditing(null);
    if (commit) onCommit(current.pageId, current.index, current.value);
  }

  return (
    <div className="grid gap-4">
      {pages.map((page) => {
        const alignment = translationLines(page.sourceText, drafts[page.id] ?? []);
        const lines = alignment.rows;
        const warning = segmentMismatchWarning(alignment);
        return (
          <article
            key={page.id}
            className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white text-[15px] leading-6 text-ink shadow-[0_1px_2px_rgba(11,18,32,0.06)]"
          >
            <div className="grid grid-cols-2 border-b border-line">
              <p className="px-4 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                Page {page.pageNumber} source
              </p>
              <p className="border-l border-line px-4 py-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                Translation
              </p>
            </div>
            {warning ? (
              <p data-testid="translation-mismatch" className="bg-[#fff8ee] px-4 py-1.5 text-[13px] text-[#b45309]">
                {warning}
              </p>
            ) : null}
            {lines.length === 0 ? (
              <p className="px-4 py-6 text-ink-muted">No source text</p>
            ) : (
              lines.map((line, index) => {
                const editingThis =
                  editing?.pageId === page.id && line.segmentIndex !== null && editing.index === line.segmentIndex;
                const interactive = canEdit && line.segmentIndex !== null && !editingThis;
                const label = `Translation page ${page.pageNumber} segment ${(line.segmentIndex ?? index) + 1}`;
                return (
                  <div
                    key={`${page.id}-${index}`}
                    data-testid={`translation-row-${page.id}-${index}`}
                    data-blank={line.segmentIndex === null ? "true" : "false"}
                    data-segment-index={line.segmentIndex ?? ""}
                    role={interactive ? "button" : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-label={interactive ? label : undefined}
                    className={`${ROW} min-h-8${interactive ? " cursor-text" : ""}`}
                    onClick={() => {
                      if (line.segmentIndex === null) return;
                      begin(page.id, line.segmentIndex, line.translation);
                    }}
                    onKeyDown={(event) => {
                      if (!interactive) return;
                      if (event.target instanceof HTMLInputElement) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        begin(page.id, line.segmentIndex as number, line.translation);
                      }
                    }}
                  >
                    <div className="min-w-0 whitespace-pre-wrap break-words px-4 py-1.5">{line.source || "\u00a0"}</div>
                    <div className="min-w-0 border-l border-line px-3 py-1">
                      {editingThis && line.segmentIndex !== null ? (
                        <input
                          aria-label={label}
                          data-testid="translation-input"
                          value={editing.value}
                          autoFocus
                          onChange={(event) => {
                            const value = event.target.value;
                            setEditing((current) => {
                              if (!current) return current;
                              const next = { ...current, value };
                              editingRef.current = next;
                              return next;
                            });
                          }}
                          onBlur={() => finish(true)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.stopPropagation();
                              finish(true);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              finish(false);
                            }
                          }}
                          className="w-full rounded-[var(--cp-radius)] border border-primary bg-white px-2 py-0.5 text-[15px] leading-6 text-ink outline-none ring-1 ring-primary"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words px-1 py-0.5">{line.translation || "\u00a0"}</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </article>
        );
      })}
    </div>
  );
}
