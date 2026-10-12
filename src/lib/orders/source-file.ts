import { ORIGINALS_BUCKET, SOURCE_URL_SECONDS } from "./constants";
import { HttpError } from "./errors";

export type SourceFileResponse = {
  url: string;
  expiresAt: string;
};

type SourceDocument = {
  id: string;
  originalPath: string;
};

/**
 * The original upload for this order. The bucket is always `originals`.
 * A file id from another order, or a translated file, is not in this list.
 */
export function sourceFileTarget(
  documents: SourceDocument[],
  fileId: string,
): { bucket: typeof ORIGINALS_BUCKET; path: string } {
  const id = fileId.trim();
  const document = id ? documents.find((item) => item.id === id) : undefined;
  const path = document?.originalPath.trim() ?? "";
  if (!path) throw new HttpError("Not found", 404);
  return { bucket: ORIGINALS_BUCKET, path };
}

/** `{ url, expiresAt }` with `expiresAt` about 10 minutes after `now`. */
export function sourceFileBody(url: string, now = Date.now()): SourceFileResponse {
  return {
    url,
    expiresAt: new Date(now + SOURCE_URL_SECONDS * 1000).toISOString(),
  };
}
