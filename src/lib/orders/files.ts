import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "./constants";
import { HttpError } from "./errors";

const EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const ALLOWED = new Set(Object.values(EXTENSIONS));

export function resolveUploadMime(filename: string, mime: string): string | null {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (ALLOWED.has(normalized)) return normalized === "image/jpg" ? "image/jpeg" : normalized;
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[extension] ?? null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "upload";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "upload";
}

export function assertUploadBudget(files: { size: number }[]): void {
  if (files.length < 1) {
    throw new HttpError("Upload at least one file", 400);
  }
  if (files.length > MAX_FILES) {
    throw new HttpError(`Upload at most ${MAX_FILES} files`, 400);
  }

  let total = 0;
  for (const file of files) {
    if (file.size <= 0) throw new HttpError("Empty files are not accepted", 400);
    if (file.size > MAX_FILE_BYTES) {
      throw new HttpError("Each file must be 25MB or smaller", 400);
    }
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new HttpError("The upload is larger than 100MB", 400);
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function assertEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.length < 3 || trimmed.length > 320 || !EMAIL.test(trimmed)) {
    throw new HttpError("Enter a valid email address", 400);
  }
  return trimmed;
}
