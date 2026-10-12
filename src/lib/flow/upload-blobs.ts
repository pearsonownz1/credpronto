const filesById = new Map<string, File>();
const filesByName = new Map<string, File>();

function key(token: string, id: string) {
  return `${token}\0${id}`;
}

/** Keep the files from this upload so the quote can preview them without a signed URL. */
export function rememberUpload(token: string, files: File[]) {
  for (const file of files) filesByName.set(key(token, file.name), file);
}

/** A replacement is known by document id, which does not change when the name does. */
export function rememberDocument(token: string, fileId: string, file: File) {
  filesById.set(key(token, fileId), file);
  filesByName.set(key(token, file.name), file);
}

export function uploadBlobFor(token: string, fileId: string, filename: string): File | null {
  return filesById.get(key(token, fileId)) ?? filesByName.get(key(token, filename)) ?? null;
}
