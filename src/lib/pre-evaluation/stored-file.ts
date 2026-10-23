import type { PreEvaluationStoredFile } from "./client";

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${units[unit]}`;
}

/** Pages and size for the carried file row. Pages are omitted when the count is missing. */
export function carriedFileDetail(file: Pick<PreEvaluationStoredFile, "pageCount" | "size">): string {
  const size = formatFileSize(file.size);
  if (!Number.isInteger(file.pageCount) || file.pageCount < 1) return size;
  const pages = file.pageCount === 1 ? "1 page" : `${file.pageCount} pages`;
  return size ? `${pages} · ${size}` : pages;
}

/** Send the id only while the prefill file is still attached. Removing it falls back to a normal upload. */
export function orderPreEvaluationId(input: {
  id: string | null | undefined;
  file: PreEvaluationStoredFile | null;
  removed: boolean;
}): string | null {
  if (input.removed || !input.file) return null;
  const id = input.id?.trim() ?? "";
  return id || null;
}
