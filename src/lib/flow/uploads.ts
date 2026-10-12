export const CUSTOMER_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

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
