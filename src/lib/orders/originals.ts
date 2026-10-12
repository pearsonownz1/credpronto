import { ORIGINALS_BUCKET } from "./constants";
import { downloadFilename } from "./download-name";
import { HttpError } from "./errors";

export type OriginalSource = {
  id: string;
  filename: string;
  position: number;
  originalPath: string;
};

/** Object to sign. The path is the upload key and is not part of the JSON body. */
export type OriginalTarget = {
  documentId: string;
  documentIndex: number;
  documentName: string;
  filename: string;
  bucket: typeof ORIGINALS_BUCKET;
  path: string;
};

export type SignedOriginal = {
  documentId: string;
  documentIndex: number;
  documentName: string;
  filename: string;
  url: string;
};

export type OriginalFileResponse = {
  url: string;
  filename: string;
  expiresInSeconds: number;
  documentId: string;
  documentIndex: number;
  documentName: string;
};

export type OriginalListResponse = {
  expiresInSeconds: number;
  originals: SignedOriginal[];
};

export type OriginalDownloadResponse = OriginalFileResponse | OriginalListResponse;

function orderedDocuments(documents: OriginalSource[]): OriginalSource[] {
  return [...documents].sort(
    (a, b) => a.position - b.position || a.filename.localeCompare(b.filename),
  );
}

function requestedId(documentId: string | null): string | null {
  const trimmed = documentId?.trim() ?? "";
  return trimmed || null;
}

/**
 * Uploads to sign for `file=original`. `documentId` selects one file.
 * Index follows upload order, the same order as `documents` on the order payload.
 */
export function originalTargets(documents: OriginalSource[], documentId: string | null): OriginalTarget[] {
  const ordered = orderedDocuments(documents);
  if (ordered.length === 0) throw new HttpError("That file is not ready", 404);

  const requested = requestedId(documentId);
  const selected = requested ? ordered.filter((document) => document.id === requested) : ordered;
  if (requested && selected.length === 0) throw new HttpError("Unknown document.", 404);

  return selected.map((document) => {
    if (!document.originalPath.trim()) throw new HttpError("That file is not ready", 404);
    return {
      documentId: document.id,
      documentIndex: ordered.findIndex((item) => item.id === document.id),
      documentName: document.filename,
      filename: downloadFilename("original", document.filename),
      bucket: ORIGINALS_BUCKET,
      path: document.originalPath,
    };
  });
}

/**
 * One signed URL when the caller named a document or the order has a single upload.
 * A list when several uploads are requested together.
 */
export function originalDownloadResponse(
  signed: SignedOriginal[],
  expiresInSeconds: number,
  documentId: string | null,
): OriginalDownloadResponse {
  if (signed.length === 0) throw new HttpError("That file is not ready", 404);
  const single = requestedId(documentId) != null || signed.length === 1;
  if (single) {
    const file = signed[0];
    if (!file || signed.length !== 1) throw new HttpError("Unknown document.", 404);
    return {
      url: file.url,
      filename: file.filename,
      expiresInSeconds,
      documentId: file.documentId,
      documentIndex: file.documentIndex,
      documentName: file.documentName,
    };
  }

  return {
    expiresInSeconds,
    originals: signed.map((file) => ({
      documentId: file.documentId,
      documentIndex: file.documentIndex,
      documentName: file.documentName,
      filename: file.filename,
      url: file.url,
    })),
  };
}
