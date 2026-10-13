import { randomUUID } from "node:crypto";
import { optionalUser } from "@/lib/auth/session";
import { ORIGINALS_BUCKET } from "./constants";
import {
  insertDocument,
  insertEvent,
  insertOrder,
  upsertCustomer,
  type Db,
} from "./db";
import { readDirectOrder, referencedOriginals, storeReferencedFiles } from "./direct-upload";
import { assertEmail, safeFilename } from "./files";
import { serviceDb, uploadObject } from "./storage";
import { generateOrderToken, hashOrderToken } from "./token";
import { evaluationFeeCents, evaluationUnitCents, parseOrderChoice } from "./evaluation-price";
import type { OrderType } from "./types";

/**
 * A validated session owns the customer email. The body email is used only
 * when there is no session, and is never a fallback for a session user.
 */
export function resolveOrderCustomer(input: {
  session: { id: string; email: string | null } | null;
  bodyEmail: string | null;
}): { email: string; userId: string | null } {
  if (input.session) {
    return {
      email: assertEmail(input.session.email ?? ""),
      userId: input.session.id || null,
    };
  }
  return { email: assertEmail(input.bodyEmail ?? ""), userId: null };
}

export async function createOrder(request: Request): Promise<{
  orderToken: string;
  orderId: string;
  email: string;
  documentCount: number;
  estimatedCents: number | null;
  sourceLanguage: string | null;
  targetLanguage: string;
  orderType: OrderType;
}> {
  const body = await readDirectOrder(request);
  const session = await optionalUser();
  const { email, userId } = resolveOrderCustomer({
    session: session ? { id: session.id, email: session.email } : null,
    bodyEmail: body.email,
  });
  const choice = parseOrderChoice({
    orderType: body.orderType,
    service: body.service,
    degreeCount: body.degreeCount,
    includeTranslation: body.includeTranslation,
  });

  const db = serviceDb();
  const files = await referencedOriginals(db, body.sessionId, body.files);
  const customer = await upsertCustomer(db, email);
  const orderToken = generateOrderToken();
  const evaluationCents =
    choice.service && choice.degreeCount != null
      ? evaluationFeeCents(choice.service, choice.degreeCount)
      : null;
  const order = await insertOrder(db, {
    id: body.sessionId,
    tokenHash: hashOrderToken(orderToken),
    customerId: customer.id,
    orderType: choice.orderType,
    serviceType: choice.orderType === "evaluation" ? "evaluation" : "translation",
    service: choice.service,
    degreeCount: choice.degreeCount,
    includeTranslation: choice.includeTranslation,
    evaluationCents,
    translationCents: evaluationCents == null ? null : 0,
    totalCents: evaluationCents,
    unitPriceCents: choice.service ? evaluationUnitCents(choice.service) : null,
    utmSource: body.utmSource,
    utmMedium: body.utmMedium,
    utmCampaign: body.utmCampaign,
    gclid: body.gclid,
    landingPath: body.landingPath,
    userId,
  });

  await insertEvent(db, order.id, "upload_started", { fileCount: files.length });
  await storeReferencedFiles(db, order.id, files);
  await insertEvent(db, order.id, "upload_done", { fileCount: files.length });
  await insertEvent(db, order.id, "staff_notified", { channel: "event" });

  return {
    orderToken,
    orderId: order.id,
    email,
    documentCount: files.length,
    estimatedCents: order.evaluationCents,
    sourceLanguage: order.sourceLanguage,
    targetLanguage: order.targetLanguage,
    orderType: order.orderType,
  };
}

export async function storeFiles(
  db: Db,
  orderId: string,
  files: Array<{ filename: string; mime: string; bytes: Uint8Array }>,
): Promise<void> {
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const id = randomUUID();
    const path = `${orderId}/${id}/${safeFilename(file.filename)}`;
    await uploadObject(db, ORIGINALS_BUCKET, path, file.bytes, file.mime);
    await insertDocument(db, {
      id,
      orderId,
      originalPath: path,
      filename: file.filename,
      mime: file.mime,
      size: file.bytes.byteLength,
      position: index + 1,
    });
  }
}
