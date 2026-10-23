import { DOWNLOAD_URL_SECONDS, FINALS_BUCKET } from "./constants";
import { getDelivery, getOrderById, type Db } from "./db";
import { HttpError } from "./errors";
import { requireStaff } from "./staff";
import { signedObjectUrl } from "./storage";
import type { DeliveryRecord, OrderRecord } from "./types";

/** Signed URLs for staff downloads live for 60 seconds. Staff click, the browser fetches, done. */
export const STAFF_DOWNLOAD_URL_SECONDS = Math.min(60, DOWNLOAD_URL_SECONDS);
export const STAFF_DOWNLOAD_AUDIT_TABLE = "staff_file_downloads";

export type StaffFileKind = "translation" | "certification" | "delivered" | "diploma" | "course_by_course";

export type StaffFile = { kind: StaffFileKind; path: string; filename: string };

const LABEL_ORDER: StaffFileKind[] = ["delivered", "diploma", "course_by_course", "translation", "certification"];

function clean(path: string | null | undefined): string | null {
  const value = typeof path === "string" ? path.trim() : "";
  return value.length > 0 ? value : null;
}

function baseName(path: string): string {
  return path.split("/").filter((part) => part.length > 0).pop() ?? path;
}

/**
 * Every finals-bucket file staff may pull for this order: the delivered package, each uploaded
 * evaluation report, and the final translation and certification. Deduplicated by path, and
 * only paths under the order's own folder.
 */
export function staffOrderFiles(
  order: Pick<OrderRecord, "id" | "finalTranslationPath" | "certificationPath" | "serviceFiles">,
  delivery: Pick<DeliveryRecord, "finalPath" | "certificationPath"> | null,
): StaffFile[] {
  const candidates: Array<[StaffFileKind, string | null]> = [
    ["delivered", clean(delivery?.finalPath)],
    ["diploma", clean(order.serviceFiles?.diploma)],
    ["course_by_course", clean(order.serviceFiles?.course_by_course)],
    ["translation", clean(order.finalTranslationPath)],
    ["certification", clean(order.certificationPath)],
    ["certification", clean(delivery?.certificationPath)],
  ];
  const seen = new Set<string>();
  const files: StaffFile[] = [];
  for (const [kind, path] of candidates) {
    if (!path || seen.has(path)) continue;
    if (!path.startsWith(`${order.id}/`) || path.includes("..")) continue;
    seen.add(path);
    files.push({ kind, path, filename: baseName(path) });
  }
  return files.sort((a, b) => LABEL_ORDER.indexOf(a.kind) - LABEL_ORDER.indexOf(b.kind));
}

async function loadFiles(db: Db, orderId: string): Promise<StaffFile[]> {
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  return staffOrderFiles(order, await getDelivery(db, order.id));
}

export async function listStaffOrderFiles(orderId: string): Promise<{ files: StaffFile[] }> {
  const { db } = await requireStaff();
  return { files: await loadFiles(db, orderId) };
}

function readPath(body: unknown): string {
  const path = body && typeof body === "object" ? (body as { path?: unknown }).path : undefined;
  if (typeof path !== "string" || path.trim().length === 0) throw new HttpError("path is required", 400);
  return path.trim();
}

/**
 * One staff download. The audit row is written first; if it cannot be written no URL is issued.
 */
export async function staffDownloadFile(
  orderId: string,
  body: unknown,
): Promise<{ url: string; filename: string; kind: StaffFileKind; expiresInSeconds: number }> {
  const { db, userId, email } = await requireStaff();
  const path = readPath(body);
  const file = (await loadFiles(db, orderId)).find((candidate) => candidate.path === path);
  if (!file) throw new HttpError("That file is not on this order", 404);

  const logged = await db.from(STAFF_DOWNLOAD_AUDIT_TABLE).insert({
    staff_user_id: userId,
    staff_email: email ?? null,
    order_id: orderId,
    bucket: FINALS_BUCKET,
    file_path: file.path,
    file_kind: file.kind,
  });
  if (logged.error) {
    console.error(`staff download audit failed: ${logged.error.message}`);
    throw new HttpError("Download log is unavailable, so the download was refused", 503);
  }

  const url = await signedObjectUrl(db, FINALS_BUCKET, file.path, STAFF_DOWNLOAD_URL_SECONDS, {
    download: file.filename,
  });
  return { url, filename: file.filename, kind: file.kind, expiresInSeconds: STAFF_DOWNLOAD_URL_SECONDS };
}
