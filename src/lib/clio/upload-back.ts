import { orderHasEvaluation } from "@/lib/orders/service-selection";
import { FINALS_BUCKET } from "@/lib/orders/constants";
import { getOrderById } from "@/lib/orders/db";
import { HttpError } from "@/lib/orders/errors";
import { requireStaff } from "@/lib/orders/staff";
import { downloadObject, serviceDb, type Db } from "@/lib/orders/storage";
import type { OrderRecord } from "@/lib/orders/types";
import { clioCredentials } from "./config";
import { uploadMatterPdf } from "./documents";
import { ensureFreshConnection } from "./oauth";
import { safeClioMessage } from "./redact";
import { clioStore } from "./store";
import type { ClioFetch } from "./api";
import type { ClioStore } from "./types";

export function isPureTranslationOrder(order: {
  orderType?: string | null;
  serviceType?: string | null;
  service?: string | null;
  services?: readonly string[] | null;
  includeTranslation?: boolean | null;
}): boolean {
  if (order.orderType === "evaluation" || order.orderType === "expert_letter") return false;
  if (order.serviceType === "evaluation" || order.serviceType === "expert_letter") return false;
  if (order.service) return false;
  return !orderHasEvaluation(order);
}

export type ClioUploadResult =
  | { status: "skipped" }
  | { status: "uploaded"; clioDocumentId: string | null }
  | { status: "failed"; error: string };

export async function uploadLinkedTranslation(
  db: Db,
  order: OrderRecord,
  deps: { store?: ClioStore; fetchImpl?: ClioFetch } = {},
): Promise<ClioUploadResult> {
  if (!isPureTranslationOrder(order)) return { status: "skipped" };
  const store = deps.store ?? clioStore(db);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const link = await store.matterOrder(order.id);
  if (!link) return { status: "skipped" };
  if (link.uploadStatus === "uploaded") return { status: "uploaded", clioDocumentId: link.clioDocumentId };
  if (order.status !== "approved" && order.status !== "delivered") {
    throw new HttpError("This translation is not approved yet", 409);
  }
  const fail = async (error: unknown): Promise<ClioUploadResult> => {
    const message = safeClioMessage(error);
    console.error(`clio upload failed for order ${order.id}: ${message}`);
    await store.updateMatterOrder(order.id, { uploadStatus: "failed", uploadError: message, uploadedAt: null });
    return { status: "failed", error: message };
  };
  try {
    const path = order.finalTranslationPath || order.certificationPath;
    if (!path) return fail(new Error("Certified PDF is not stored yet"));
    const bytes = await downloadObject(db, FINALS_BUCKET, path);
    const connection = await store.connectionForUser(link.userId);
    if (!connection) return fail(new Error("Clio is not connected"));
    const ready = await ensureFreshConnection({
      fetchImpl,
      store,
      connection,
      credentials: clioCredentials(),
    });
    const clioDocumentId = await uploadMatterPdf({
      fetchImpl,
      region: ready.region,
      token: ready.accessToken,
      matterId: link.matterId,
      filename: "certified-translation.pdf",
      bytes,
    });
    const uploadedAt = new Date().toISOString();
    await store.updateMatterOrder(order.id, {
      uploadStatus: "uploaded",
      uploadError: null,
      clioDocumentId,
      uploadedAt,
    });
    return { status: "uploaded", clioDocumentId };
  } catch (error) {
    return fail(error);
  }
}

export async function uploadApprovedClioTranslation(db: Db, order: OrderRecord): Promise<void> {
  try {
    await uploadLinkedTranslation(db, order);
  } catch (error) {
    console.error(safeClioMessage(error));
  }
}

export async function uploadApprovedClioTranslationById(orderId: string): Promise<void> {
  try {
    const db = serviceDb();
    const order = await getOrderById(db, orderId);
    if (!order) return;
    await uploadApprovedClioTranslation(db, order);
  } catch (error) {
    console.error(safeClioMessage(error));
  }
}

export async function retryClioUploadForUser(db: Db, userId: string, orderId: string): Promise<ClioUploadResult> {
  const store = clioStore(db);
  const link = await store.matterOrder(orderId);
  if (!link) throw new HttpError("Order not found", 404);
  if (link.userId !== userId) await requireStaff();
  const order = await getOrderById(db, orderId);
  if (!order || !isPureTranslationOrder(order)) {
    throw new HttpError("Only a translation order can be sent back to Clio", 409);
  }
  const result = await uploadLinkedTranslation(db, order, { store });
  if (result.status === "skipped") throw new HttpError("Order not found", 404);
  return result;
}
