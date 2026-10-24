import { createHash, randomUUID } from "node:crypto";
import { DIRECT_FILE_LIMIT_MESSAGE, MAX_DIRECT_FILE_BYTES, ORIGINALS_BUCKET } from "./constants";
import { insertDocument, type Db } from "./db";
import { HttpError } from "./errors";
import { resolveUploadMime, safeFilename } from "./file-type";
import { rejectCustomerTotal } from "./customer-total";
import { rejectCustomerPageCount } from "./evaluation-price";
import { createSignedUpload, downloadObject, originalObjectInfo } from "./storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UploadTicketInput = {
  name: string;
  size: number;
  type: string;
};

export type UploadTicket = {
  path: string;
  token: string;
  signedUrl: string;
  filename: string;
  mime: string;
  size: number;
};

export type DirectOrderFile = {
  path: string;
  filename: string;
  mime: string;
  size: number;
};

/** One originals object the pipeline already reads from `documents`. */
export type StoredOriginal = {
  id: string;
  path: string;
  filename: string;
  mime: string;
  size: number;
  /** Physical pages when this server already counted the file. Photos are 1. */
  pageCount?: number | null;
};

export function assertDirectFile(file: {
  name?: unknown;
  size?: unknown;
  type?: unknown;
}): { filename: string; mime: string; size: number } {
  const filename = typeof file.name === "string" ? file.name.trim() : "";
  if (!filename) throw new HttpError("Upload at least one file", 400);
  const size = typeof file.size === "number" ? file.size : Number(file.size);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError("Empty files are not accepted", 400);
  if (size > MAX_DIRECT_FILE_BYTES) throw new HttpError(DIRECT_FILE_LIMIT_MESSAGE, 400);
  const mime = resolveUploadMime(filename, typeof file.type === "string" ? file.type : "");
  if (!mime) throw new HttpError(`Unsupported file type: ${filename}`, 415);
  return { filename, mime, size };
}

export function ticketFiles(body: unknown): UploadTicketInput[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("Expected a JSON body", 400);
  }
  const files = (body as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length < 1) throw new HttpError("Upload at least one file", 400);
  return files.map((file) => {
    if (!file || typeof file !== "object") throw new HttpError("Upload at least one file", 400);
    const row = file as { name?: unknown; size?: unknown; type?: unknown };
    const checked = assertDirectFile(row);
    return { name: checked.filename, size: checked.size, type: checked.mime };
  });
}

/**
 * Object key for one file in this upload session.
 * The first segment is the session id, which becomes the order id.
 */
export function uploadObjectPath(sessionId: string, fileId: string, filename: string): string {
  return `${sessionId}/${fileId}/${safeFilename(filename)}`;
}

/** Reject any key that is not `{sessionId}/{fileId}/{filename}` for this session. */
export function assertSessionPath(sessionId: string, path: string): { fileId: string; filename: string } {
  const session = sessionId.trim();
  if (!UUID.test(session)) throw new HttpError("Unknown upload", 400);
  if (
    typeof path !== "string" ||
    path !== path.trim() ||
    path.includes("\\") ||
    path.includes("%") ||
    path.includes("\0") ||
    path.includes("//")
  ) {
    throw new HttpError("That file is outside this upload", 400);
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new HttpError("That file is outside this upload", 400);
  }
  if (parts.length !== 3 || parts[0] !== session) {
    throw new HttpError("That file is outside this upload", 400);
  }
  const fileId = parts[1] ?? "";
  const filename = parts[2] ?? "";
  if (!UUID.test(fileId) || filename !== safeFilename(filename)) {
    throw new HttpError("That file is outside this upload", 400);
  }
  return { fileId, filename };
}

export async function issueUploadSession(
  db: Db,
  files: readonly UploadTicketInput[],
): Promise<{ sessionId: string; uploads: UploadTicket[] }> {
  if (files.length < 1) throw new HttpError("Upload at least one file", 400);
  const sessionId = randomUUID();
  const uploads: UploadTicket[] = [];
  for (const file of files) {
    const checked = assertDirectFile(file);
    const fileId = randomUUID();
    const path = uploadObjectPath(sessionId, fileId, checked.filename);
    const signed = await createSignedUpload(db, path);
    if (assertSessionPath(sessionId, signed.path).filename !== safeFilename(checked.filename)) {
      throw new HttpError("Could not start the upload", 503);
    }
    uploads.push({
      path: signed.path,
      token: signed.token,
      signedUrl: signed.signedUrl,
      filename: checked.filename,
      mime: checked.mime,
      size: checked.size,
    });
  }
  return { sessionId, uploads };
}

export { rejectCustomerTotal };

function readServices(value: unknown): string[] | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const names = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
    return names.length > 0 ? names : null;
  }
  if (!Array.isArray(value)) throw new HttpError("services must be a list of translation, diploma, and course_by_course", 400);
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new HttpError("services must be a list of translation, diploma, and course_by_course", 400);
    }
    names.push(item.trim());
  }
  return names.length > 0 ? names : null;
}

function readOrderBrand(value: unknown): "gcs" | null {
  if (value == null || value === "") return null;
  if (value === "credpronto") return null;
  if (value === "gcs") return "gcs";
  throw new HttpError("Unknown order brand", 400);
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 500) : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

export type DirectOrderFields = {
  email: string | null;
  /** Empty when the only file is a pre-evaluation the server will copy. */
  sessionId: string;
  files: DirectOrderFile[];
  /** Public pre-evaluation id. The server loads the stored object itself. */
  preEvaluationId: string | null;
  orderType: string | null;
  service: string | null;
  degreeCount: string | null;
  includeTranslation: string | null;
  services: string[] | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  gclid: string | null;
  landingPath: string | null;
  brand: "gcs" | null;
  clientName: string | null;
  sourceLanguage: string | null;
  targetLanguage: string | null;
};

function readPreEvaluationId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError("Pre-evaluation not found", 404);
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseDirectOrder(body: unknown): DirectOrderFields {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("Expected a JSON body", 400);
  }
  const record = body as Record<string, unknown>;
  rejectCustomerPageCount(record);
  rejectCustomerTotal(record);
  const preEvaluationId = readPreEvaluationId(record.preEvaluationId);
  const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  const files = record.files;
  const listed = Array.isArray(files) ? files : null;
  if (files != null && !listed) throw new HttpError("Upload at least one file", 400);
  if ((!listed || listed.length < 1) && !preEvaluationId) throw new HttpError("Upload at least one file", 400);
  if (listed && listed.length > 0) {
    if (!UUID.test(sessionId)) throw new HttpError("Unknown upload", 400);
  } else if (sessionId && !UUID.test(sessionId)) {
    throw new HttpError("Unknown upload", 400);
  }
  return {
    email: asText(record.email),
    sessionId,
    preEvaluationId,
    files: (listed ?? []).map((file) => {
      if (!file || typeof file !== "object") throw new HttpError("Upload at least one file", 400);
      const row = file as Record<string, unknown>;
      const path = typeof row.path === "string" ? row.path : "";
      assertSessionPath(sessionId, path);
      const filename = typeof row.filename === "string" ? row.filename.trim() : "";
      if (!filename) throw new HttpError("Upload at least one file", 400);
      return {
        path,
        filename,
        mime: typeof row.mime === "string" ? row.mime : "",
        size: typeof row.size === "number" ? row.size : Number(row.size),
      };
    }),
    orderType: asText(record.orderType),
    service: asText(record.service),
    degreeCount: asText(record.degreeCount),
    includeTranslation: asText(record.includeTranslation),
    services: readServices(record.services),
    utmSource: asText(record.utm_source),
    utmMedium: asText(record.utm_medium),
    utmCampaign: asText(record.utm_campaign),
    gclid: asText(record.gclid),
    landingPath: asText(record.landing_path),
    brand: readOrderBrand(record.brand),
    clientName: asText(record.clientName),
    sourceLanguage: asText(record.sourceLanguage),
    targetLanguage: asText(record.targetLanguage),
  };
}

export async function readDirectOrder(request: Request): Promise<DirectOrderFields> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError("Expected a JSON body", 400);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError("Expected a JSON body", 400);
  }
  return parseDirectOrder(body);
}

async function hashOriginal(db: Db, path: string): Promise<string> {
  try {
    const bytes = await downloadObject(db, ORIGINALS_BUCKET, path);
    return createHash("sha256").update(bytes).digest("hex");
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    const message = cause instanceof Error && cause.message.trim() ? cause.message : "That file is not uploaded yet";
    throw new HttpError(message, 400);
  }
}

/** Confirm each object is in this session, then drop later copies of the same bytes. */
export async function referencedOriginals(
  db: Db,
  sessionId: string,
  files: readonly DirectOrderFile[],
): Promise<StoredOriginal[]> {
  if (files.length < 1) throw new HttpError("Upload at least one file", 400);
  const prepared: StoredOriginal[] = [];
  const seenPaths = new Set<string>();
  for (const file of files) {
    const located = assertSessionPath(sessionId, file.path);
    if (seenPaths.has(file.path)) continue;
    seenPaths.add(file.path);
    const filename = file.filename.trim();
    if (!filename || safeFilename(filename) !== located.filename) {
      throw new HttpError("That file is outside this upload", 400);
    }
    const mime = resolveUploadMime(filename, file.mime);
    if (!mime) throw new HttpError(`Unsupported file type: ${filename}`, 415);
    const info = await originalObjectInfo(db, file.path);
    if (info.size <= 0) throw new HttpError("Empty files are not accepted", 400);
    if (info.size > MAX_DIRECT_FILE_BYTES) throw new HttpError(DIRECT_FILE_LIMIT_MESSAGE, 400);
    prepared.push({
      id: located.fileId,
      path: file.path,
      filename,
      mime,
      size: info.size,
    });
  }
  if (prepared.length < 1) throw new HttpError("Upload at least one file", 400);

  const counts = new Map<number, number>();
  for (const file of prepared) counts.set(file.size, (counts.get(file.size) ?? 0) + 1);
  const seenHashes = new Set<string>();
  const unique: StoredOriginal[] = [];
  for (const file of prepared) {
    if ((counts.get(file.size) ?? 0) < 2) {
      unique.push(file);
      continue;
    }
    const hash = await hashOriginal(db, file.path);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);
    unique.push(file);
  }
  return unique;
}

/**
 * Insert the same `documents` rows `storeFiles` writes today.
 * The bytes are already in `originals`; this does not upload them again.
 */
export async function storeReferencedFiles(db: Db, orderId: string, files: readonly StoredOriginal[]): Promise<void> {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;
    await insertDocument(db, {
      id: file.id,
      orderId,
      originalPath: file.path,
      filename: file.filename,
      mime: file.mime,
      size: file.size,
      position: index + 1,
      pageCount: file.pageCount ?? null,
    });
  }
}
