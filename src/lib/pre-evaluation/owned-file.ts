import { randomUUID } from "node:crypto";
import {
  DIRECT_FILE_LIMIT_MESSAGE,
  MAX_DIRECT_FILE_BYTES,
  ORIGINALS_BUCKET,
  PRE_EVALUATIONS_BUCKET,
} from "@/lib/orders/constants";
import { assertSessionPath, uploadObjectPath, type StoredOriginal } from "@/lib/orders/direct-upload";
import { HttpError } from "@/lib/orders/errors";
import { resolveUploadMime, safeFilename } from "@/lib/orders/file-type";
import { countOriginalPages } from "@/lib/orders/stored-pages";
import { downloadObject, uploadObject, type Db } from "@/lib/orders/storage";
import { hashOrderToken, isOrderToken } from "@/lib/orders/token";
import type { PreEvalMime } from "./constants";
import { preEvaluationByTokenHash, type PreEvaluationRecord } from "./db";
import { assertPreEvalBurst, requestIpHash } from "./rate-limit";

export type PreEvaluationFileKind = "diploma" | "transcript";

/** Shown on the upload form. These keys are the whole file object. */
export type PreEvaluationFile = {
  name: string;
  mimeType: PreEvalMime;
  size: number;
  pageCount: number;
  kind: PreEvaluationFileKind;
};

const NOT_FOUND = "Pre-evaluation not found";

/** Lead email on the suggestion, compared to the signed-in account. Body email is not ownership. */
export function accountOwnsPreEvaluation(
  accountEmail: string | null | undefined,
  leadEmail: string | null | undefined,
): boolean {
  const account = accountEmail?.trim().toLowerCase() ?? "";
  const lead = leadEmail?.trim().toLowerCase() ?? "";
  return account.length > 0 && account === lead;
}

/** Stored object key. Never a path from the request body. */
export function assertPreEvaluationObjectPath(path: string): string {
  if (
    path !== path.trim() ||
    path.length < 3 ||
    path.length > 512 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("%") ||
    path.includes("\0") ||
    path.includes("//")
  ) {
    throw new HttpError(NOT_FOUND, 404);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new HttpError(NOT_FOUND, 404);
  }
  return path;
}

export async function requireOwnedPreEvaluation(
  db: Db,
  publicId: string,
  accountEmail: string | null | undefined,
): Promise<PreEvaluationRecord> {
  const token = publicId.trim();
  if (!isOrderToken(token)) throw new HttpError(NOT_FOUND, 404);
  const record = await preEvaluationByTokenHash(db, hashOrderToken(token));
  if (!record || !accountOwnsPreEvaluation(accountEmail, record.email)) {
    throw new HttpError(NOT_FOUND, 404);
  }
  assertPreEvaluationObjectPath(record.storagePath);
  return record;
}

/** Ready and classified. Pending and unclassified match the file route: 404, no download. */
export function assertClassifiedPreEvaluation(record: PreEvaluationRecord): PreEvaluationFileKind {
  if (record.status !== "ready") throw new HttpError(NOT_FOUND, 404);
  if (record.documentKind === "diploma" || record.documentKind === "transcript") return record.documentKind;
  throw new HttpError(NOT_FOUND, 404);
}

async function originalBytes(db: Db, record: PreEvaluationRecord): Promise<Uint8Array> {
  const path = assertPreEvaluationObjectPath(record.storagePath);
  try {
    return await downloadObject(db, PRE_EVALUATIONS_BUCKET, path);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("pre-evaluation file failed");
    throw new HttpError(NOT_FOUND, 404);
  }
}

function countedPages(pages: number | null): number | null {
  if (pages == null || !Number.isInteger(pages) || pages < 1) return null;
  return pages;
}

/**
 * File already on the suggestion, for the signed-in account that owns the lead email.
 * `404` when the id is unknown, the caller is signed out, the emails differ, the
 * pre-evaluation is still pending, or the document has not been classified.
 * The body is exactly `{ preEvaluationFile }`.
 */
export async function readOwnedPreEvaluationFile(
  db: Db,
  publicId: string,
  accountEmail: string | null | undefined,
  request: Request,
  now = new Date(),
): Promise<{ preEvaluationFile: PreEvaluationFile }> {
  await assertPreEvalBurst(db, requestIpHash(request), "read", now.getTime());
  const record = await requireOwnedPreEvaluation(db, publicId, accountEmail);
  const kind = assertClassifiedPreEvaluation(record);
  const bytes = await originalBytes(db, record);
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_DIRECT_FILE_BYTES) {
    throw new HttpError(NOT_FOUND, 404);
  }
  const name = safeFilename(record.filename);
  const mimeType = record.mime;
  const pageCount = countedPages(await countOriginalPages(bytes, mimeType, name));
  if (pageCount == null) throw new HttpError("Could not read the upload", 503);
  const preEvaluationFile: PreEvaluationFile = {
    name,
    mimeType,
    size: bytes.byteLength,
    pageCount,
    kind,
  };
  return { preEvaluationFile };
}

/**
 * Copy the stored original into this order's `originals` key.
 * Page count uses the same rule as a normal upload: a photo is one page, a PDF is its page count.
 */
export async function copyPreEvaluationOriginal(
  db: Db,
  orderId: string,
  record: PreEvaluationRecord,
): Promise<StoredOriginal> {
  assertClassifiedPreEvaluation(record);
  const bytes = await originalBytes(db, record);
  if (bytes.byteLength <= 0) throw new HttpError("Empty files are not accepted", 400);
  if (bytes.byteLength > MAX_DIRECT_FILE_BYTES) throw new HttpError(DIRECT_FILE_LIMIT_MESSAGE, 400);
  const filename = safeFilename(record.filename);
  const mime = resolveUploadMime(filename, record.mime);
  if (!mime) throw new HttpError(`Unsupported file type: ${filename}`, 415);
  const pageCount = countedPages(await countOriginalPages(bytes, mime, filename));
  const fileId = randomUUID();
  const path = uploadObjectPath(orderId, fileId, filename);
  assertSessionPath(orderId, path);
  try {
    await uploadObject(db, ORIGINALS_BUCKET, path, bytes, mime);
  } catch {
    console.error("pre-evaluation file failed");
    throw new HttpError("Could not store the upload", 503);
  }
  return {
    id: fileId,
    path,
    filename,
    mime,
    size: bytes.byteLength,
    pageCount,
  };
}
