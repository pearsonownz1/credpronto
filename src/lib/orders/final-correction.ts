import { requireStaffOrService } from "./admin-access";
import { ORIGINALS_BUCKET, FINALS_BUCKET } from "./constants";
import {
  claimFinalCorrection,
  getDelivery,
  getFinalCorrection,
  getOrderById,
  insertFinalCorrection,
  listDocuments,
  listFinalCorrectionsByStatus,
  markFinalCorrectionFixed,
  updateDelivery,
  updateOrder,
  type Db,
} from "./db";
import { HttpError } from "./errors";
import { assertEvaluationPdf } from "./evaluation-review";
import { certifiedTranslationObjectPath, isCertifiedTranslationPath } from "./final-file";
import { orderForToken } from "./order-access";
import { requireStaff } from "./staff";
import { uploadObject } from "./storage";
import type { DeliveryRecord, FinalCorrectionRecord, OrderRecord } from "./types";

const TEXT_MAX = 4000;

export type SourceDocumentRef = {
  id: string;
  filename: string;
  bucket: typeof ORIGINALS_BUCKET;
  path: string;
};

export type FinalFileRefs = {
  bucket: typeof FINALS_BUCKET;
  finalTranslationPath: string | null;
  certificationPath: string | null;
  deliveryFinalPath: string | null;
  deliveryCertificationPath: string | null;
};

export type OpenCorrectionJob = {
  id: string;
  orderId: string;
  text: string;
  status: "open" | "in_progress";
  createdAt: string;
  sourceDocuments: SourceDocumentRef[];
  finals: FinalFileRefs;
};

export function parseFinalCorrectionText(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError("Expected a JSON body", 400);
  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string") throw new HttpError("text is required", 400);
  const trimmed = text.trim();
  if (!trimmed) throw new HttpError("text is required", 400);
  if (trimmed.length > TEXT_MAX) throw new HttpError("text must be 4000 characters or fewer", 400);
  return trimmed;
}

/** Pull endpoint. Omitted status means open. in_progress is only for a sweep retrying a claim it already owns. */
export function correctionListStatus(value: string | null): "open" | "in_progress" {
  if (value == null || value === "" || value === "open") return "open";
  if (value === "in_progress") return "in_progress";
  throw new HttpError("status must be open or in_progress", 400);
}

export function nextFinalVersion(path: string): number {
  const match = /-v(\d+)\.pdf$/i.exec(path);
  if (!match) return 2;
  const version = Number(match[1]);
  return Number.isInteger(version) && version >= 1 ? version + 1 : 2;
}

/**
 * Certified translations must stay on certified-translation-vN so the existing
 * bundle download still recognizes the file. Every other final gets a new key
 * and the previous object is left in place.
 */
export function correctedFinalObjectPath(orderId: string, currentPath: string, version: number): string {
  if (isCertifiedTranslationPath(currentPath)) return certifiedTranslationObjectPath(orderId, version);
  return `${orderId}/corrected-final-v${version}.pdf`;
}

/**
 * The object the customer download already reads.
 * A purchased translation on a bundle is orders.final_translation_path.
 * Everything else is the delivery final, then the order final columns.
 */
export function customerFinalPath(
  order: Pick<OrderRecord, "includeTranslation" | "finalTranslationPath" | "certificationPath">,
  delivery: Pick<DeliveryRecord, "finalPath" | "certificationPath"> | null,
): string | null {
  if (order.includeTranslation === true && isCertifiedTranslationPath(order.finalTranslationPath)) {
    return order.finalTranslationPath;
  }
  return delivery?.finalPath || delivery?.certificationPath || order.finalTranslationPath || order.certificationPath;
}

export function finalPointerPatch(
  order: Pick<OrderRecord, "finalTranslationPath" | "certificationPath">,
  delivery: Pick<DeliveryRecord, "finalPath" | "certificationPath"> | null,
  oldPath: string,
  nextPath: string,
): { order: Record<string, string>; delivery: Record<string, string> | null } {
  const orderPatch: Record<string, string> = {};
  if (order.finalTranslationPath === oldPath) orderPatch.final_translation_path = nextPath;
  if (order.certificationPath === oldPath) orderPatch.certification_path = nextPath;
  const deliveryPatch: Record<string, string> = {};
  if (delivery?.finalPath === oldPath) deliveryPatch.final_path = nextPath;
  if (delivery?.certificationPath === oldPath) deliveryPatch.certification_path = nextPath;
  return { order: orderPatch, delivery: Object.keys(deliveryPatch).length > 0 ? deliveryPatch : null };
}

function correctionBody(record: FinalCorrectionRecord) {
  return {
    id: record.id,
    orderId: record.orderId,
    text: record.text,
    status: record.status,
    finalPath: record.finalPath,
    finalVersion: record.finalVersion,
    claimedAt: record.claimedAt,
    fixedAt: record.fixedAt,
    createdAt: record.createdAt,
  };
}

export async function submitFinalCorrection(token: string, body: unknown) {
  const { db, order } = await orderForToken(token);
  if (order.status === "cancelled" || order.status === "failed") {
    throw new HttpError("This order cannot take a correction request.", 409);
  }
  const delivery = await getDelivery(db, order.id);
  if (!customerFinalPath(order, delivery)) {
    throw new HttpError("A final file has to be ready before you can request a correction.", 409);
  }
  const text = parseFinalCorrectionText(body);
  const existing = await getFinalCorrection(db, order.id);
  if (existing) throw new HttpError("A correction request already exists for this order.", 409);
  const created = await insertFinalCorrection(db, { orderId: order.id, text });
  if (!created) throw new HttpError("A correction request already exists for this order.", 409);
  return correctionBody(created);
}

export async function readFinalCorrection(orderId: string) {
  const { db } = await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const correction = await getFinalCorrection(db, order.id);
  return { correction: correction ? correctionBody(correction) : null };
}

async function jobFor(
  db: Db,
  record: FinalCorrectionRecord,
): Promise<OpenCorrectionJob> {
  const order = await getOrderById(db, record.orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const [documents, delivery] = await Promise.all([
    listDocuments(db, order.id),
    getDelivery(db, order.id),
  ]);
  return {
    id: record.id,
    orderId: record.orderId,
    text: record.text,
    status: record.status === "in_progress" ? "in_progress" : "open",
    createdAt: record.createdAt,
    sourceDocuments: documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      bucket: ORIGINALS_BUCKET,
      path: document.originalPath,
    })),
    finals: {
      bucket: FINALS_BUCKET,
      finalTranslationPath: order.finalTranslationPath,
      certificationPath: order.certificationPath,
      deliveryFinalPath: delivery?.finalPath ?? null,
      deliveryCertificationPath: delivery?.certificationPath ?? null,
    },
  };
}

export async function listFinalCorrectionJobs(request: Request, status: string | null) {
  const wanted = correctionListStatus(status);
  const { db } = await requireStaffOrService(request);
  const rows = await listFinalCorrectionsByStatus(db, wanted);
  const requests = await Promise.all(rows.map((row) => jobFor(db, row)));
  return { requests };
}

export async function claimFinalCorrectionJob(request: Request, orderId: string) {
  const { db } = await requireStaffOrService(request);
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const existing = await getFinalCorrection(db, order.id);
  if (!existing) throw new HttpError("This order has no correction request", 404);
  const claimedAt = new Date().toISOString();
  const claimed = await claimFinalCorrection(db, order.id, claimedAt);
  if (!claimed) throw new HttpError("This correction is not open", 409);
  return {
    id: claimed.id,
    orderId: claimed.orderId,
    status: claimed.status,
    claimedAt: claimed.claimedAt,
  };
}

async function readUpload(request: Request): Promise<Uint8Array> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError("Expected multipart form data", 400);
  }
  const entry = form.get("file");
  if (!(entry instanceof File)) throw new HttpError("file is required", 400);
  const bytes = new Uint8Array(await entry.arrayBuffer());
  assertEvaluationPdf(bytes);
  return bytes;
}

export async function uploadFixedFinal(request: Request, orderId: string) {
  const { db } = await requireStaffOrService(request);
  const order = await getOrderById(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);
  const existing = await getFinalCorrection(db, order.id);
  if (!existing) throw new HttpError("This order has no correction request", 404);
  if (existing.status !== "in_progress") {
    throw new HttpError(
      existing.status === "open" ? "Claim the correction before uploading a fix" : "This correction is already fixed",
      409,
    );
  }

  const bytes = await readUpload(request);
  const delivery = await getDelivery(db, order.id);
  const oldPath = customerFinalPath(order, delivery);
  if (!oldPath) throw new HttpError("This order has no final file", 409);
  const version = nextFinalVersion(oldPath);
  const nextPath = correctedFinalObjectPath(order.id, oldPath, version);
  if (!nextPath.startsWith(`${order.id}/`) || nextPath.includes("..")) {
    throw new HttpError("Could not store the corrected file", 500);
  }

  await uploadObject(db, FINALS_BUCKET, nextPath, bytes, "application/pdf");
  const pointers = finalPointerPatch(order, delivery, oldPath, nextPath);
  if (Object.keys(pointers.order).length > 0) await updateOrder(db, order.id, pointers.order);
  if (pointers.delivery) await updateDelivery(db, order.id, pointers.delivery);

  const fixedAt = new Date().toISOString();
  const fixed = await markFinalCorrectionFixed(db, order.id, { path: nextPath, version, fixedAt });
  const saved = fixed ?? (await getFinalCorrection(db, order.id));
  if (!saved || saved.status !== "fixed" || saved.finalPath !== nextPath) {
    throw new HttpError("This correction is not in progress", 409);
  }
  return {
    id: saved.id,
    orderId: saved.orderId,
    status: saved.status,
    bucket: FINALS_BUCKET,
    finalPath: saved.finalPath,
    finalVersion: saved.finalVersion,
    fixedAt: saved.fixedAt,
  };
}
