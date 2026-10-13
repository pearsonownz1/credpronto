import { createHash } from "node:crypto";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "./constants";
import { HttpError } from "./errors";

export { resolveUploadMime, safeFilename } from "./file-type";

/** Keep the first file for each SHA-256. Later copies of the same bytes are dropped. */
export function dedupeUploads<T extends { bytes: Uint8Array }>(files: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const file of files) {
    const hash = createHash("sha256").update(file.bytes).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    unique.push(file);
  }
  return unique;
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
