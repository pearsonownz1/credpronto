export const CUSTOMER_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

/** Add picked files to the ones already on this order. Same name and size is one file. */
export function addUploadFiles<T extends { name: string; size: number }>(current: T[], incoming: readonly T[]): T[] {
  return dedupeUploads([...current, ...incoming]);
}

/** Drop one row from the order's file list. Other files stay. */
export function removeUploadFile<T>(files: readonly T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= files.length) return [...files];
  return files.filter((_, current) => current !== index);
}

/** Keep the first file for each name and size. Later copies are not posted. */
export function dedupeUploads<T extends { name: string; size: number }>(files: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const file of files) {
    const key = `${file.name}\0${file.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
  }
  return unique;
}
