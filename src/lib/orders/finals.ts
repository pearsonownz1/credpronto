import { FINALS_BUCKET, MAX_FILE_BYTES } from "./constants";
import { getDelivery, getOrderById, updateDelivery, updateOrder } from "./db";
import { HttpError } from "./errors";
import { listObjectNames, uploadObject, type Db } from "./storage";
import { requireStaff } from "./staff";
import type { OrderRecord } from "./types";

const STAFF_FINAL_DIR = "staff-final";
const OBJECT_NAME = /^(\d{8}T\d{9}Z)--([A-Za-z0-9_-]+)\.pdf$/;
const STORAGE_KEY = /^[A-Za-z0-9_-]+$/;

export type StaffFinalVersion = {
  version: number;
  path: string;
  uploadedBy: string;
  uploadedAt: string;
  current: boolean;
};

export function assertPdfBytes(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new HttpError("Each file must be 25MB or smaller", 400);
  }
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (header !== "%PDF-") throw new HttpError("Upload a PDF", 400);
}

export async function readPdfUpload(request: Request): Promise<Uint8Array> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) throw new HttpError("Upload a PDF", 400);
  if (file.size > MAX_FILE_BYTES) throw new HttpError("Each file must be 25MB or smaller", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertPdfBytes(bytes);
  return bytes;
}

/** Compact UTC stamp that round-trips through `Date.toISOString()`. */
export function staffFinalObjectName(uploadedAt: string, uploadedBy: string): string {
  const date = new Date(uploadedAt);
  if (Number.isNaN(date.getTime())) throw new HttpError("Upload a PDF", 400);
  if (!STORAGE_KEY.test(uploadedBy)) throw new HttpError("Staff account is missing an id", 400);
  const iso = date.toISOString();
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}${iso.slice(20, 23)}Z`;
  return `${stamp}--${uploadedBy}.pdf`;
}

export function parseStaffFinalName(name: string): { uploadedAt: string; uploadedBy: string } | null {
  const match = OBJECT_NAME.exec(name);
  if (!match) return null;
  const stamp = match[1] ?? "";
  const uploadedBy = match[2] ?? "";
  const parts = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(stamp);
  if (!parts) return null;
  const iso = `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}.${parts[7]}Z`;
  if (new Date(iso).toISOString() !== iso) return null;
  return { uploadedAt: iso, uploadedBy };
}

export function staffFinalPath(orderId: string, objectName: string): string {
  return `${orderId}/${STAFF_FINAL_DIR}/${objectName}`;
}

export async function listStaffFinals(
  db: Db,
  orderId: string,
  currentPath: string | null,
): Promise<StaffFinalVersion[]> {
  if (!STORAGE_KEY.test(orderId)) throw new HttpError("Order not found", 404);
  const names = await listObjectNames(db, FINALS_BUCKET, `${orderId}/${STAFF_FINAL_DIR}`);
  const parsed = names.flatMap((name) => {
    const meta = parseStaffFinalName(name);
    if (!meta) return [];
    const path = staffFinalPath(orderId, name);
    return [{ path, uploadedBy: meta.uploadedBy, uploadedAt: meta.uploadedAt }];
  });
  parsed.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.path.localeCompare(b.path));
  return parsed
    .map((item, index) => ({
      version: index + 1,
      path: item.path,
      uploadedBy: item.uploadedBy,
      uploadedAt: item.uploadedAt,
      current: item.path === currentPath,
    }))
    .reverse();
}

export async function assertCurrentStaffFinal(db: Db, order: OrderRecord): Promise<StaffFinalVersion> {
  const versions = await listStaffFinals(db, order.id, order.finalTranslationPath);
  const current = versions.find((version) => version.current);
  if (!current) throw new HttpError("Upload the reviewed final PDF first", 409);
  return current;
}

export async function uploadReviewedFinal(
  db: Db,
  order: OrderRecord,
  uploaderId: string,
  bytes: Uint8Array,
): Promise<{ versions: StaffFinalVersion[] }> {
  assertPdfBytes(bytes);
  const existing = await listStaffFinals(db, order.id, order.finalTranslationPath);
  const taken = new Set(existing.map((version) => version.path));
  let uploadedAt = new Date().toISOString();
  let objectName = staffFinalObjectName(uploadedAt, uploaderId);
  let path = staffFinalPath(order.id, objectName);
  while (taken.has(path)) {
    uploadedAt = new Date(new Date(uploadedAt).getTime() + 1).toISOString();
    objectName = staffFinalObjectName(uploadedAt, uploaderId);
    path = staffFinalPath(order.id, objectName);
  }

  await uploadObject(db, FINALS_BUCKET, path, bytes, "application/pdf");
  await updateOrder(db, order.id, { final_translation_path: path });
  const delivery = await getDelivery(db, order.id);
  if (delivery) await updateDelivery(db, order.id, { final_path: path });

  const version = (existing[0]?.version ?? 0) + 1;
  return {
    versions: [
      { version, path, uploadedBy: uploaderId, uploadedAt, current: true },
      ...existing.map((item) => ({ ...item, current: false })),
    ],
  };
}

export async function listOrderFinalVersions(orderId: string): Promise<{ versions: StaffFinalVersion[] }> {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  return { versions: await listStaffFinals(db, order.id, order.finalTranslationPath) };
}

export async function saveReviewedFinal(
  orderId: string,
  request: Request,
): Promise<{ versions: StaffFinalVersion[] }> {
  const { db, userId } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const bytes = await readPdfUpload(request);
  return uploadReviewedFinal(db, order, userId, bytes);
}
