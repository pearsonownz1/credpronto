import { randomUUID } from "node:crypto";
import { optionalUser } from "@/lib/auth/session";
import { linkPreEvaluationOrder, releasePreEvaluationOrder } from "@/lib/pre-evaluation/db";
import {
  assertClassifiedPreEvaluation,
  copyPreEvaluationOriginal,
  requireOwnedPreEvaluation,
} from "@/lib/pre-evaluation/owned-file";
import { ORIGINALS_BUCKET } from "./constants";
import {
  deleteOrder,
  insertCustomerWithoutEmail,
  insertDocument,
  insertEvent,
  insertOrder,
  upsertCustomer,
  type Db,
} from "./db";
import { readDirectOrder, referencedOriginals, storeReferencedFiles } from "./direct-upload";
import { HttpError } from "./errors";
import { assertEmail, safeFilename } from "./files";
import { serviceDb, uploadObject } from "./storage";
import { generateOrderToken, hashOrderToken } from "./token";
import { parseOrderChoice } from "./evaluation-price";
import { priceServices } from "./service-selection";
import type { OrderType } from "./types";

/**
 * A validated session owns the customer email. The body email is used only
 * when there is no session, and is never a fallback for a session user.
 * A guest may leave the address blank. Signup or sign-in writes it later.
 */
export function resolveOrderCustomer(input: {
  session: { id: string; email: string | null } | null;
  bodyEmail: string | null;
}): { email: string | null; userId: string | null } {
  if (input.session) {
    return {
      email: assertEmail(input.session.email ?? ""),
      userId: input.session.id || null,
    };
  }
  const bodyEmail = input.bodyEmail?.trim() ?? "";
  if (!bodyEmail) return { email: null, userId: null };
  return { email: assertEmail(bodyEmail), userId: null };
}

export async function createOrder(request: Request): Promise<{
  orderToken: string;
  orderId: string;
  email: string | null;
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
    services: body.services,
  });

  const db = serviceDb();
  const sessionId = body.sessionId || randomUUID();
  const adopted = body.preEvaluationId
    ? await requireOwnedPreEvaluation(db, body.preEvaluationId, session?.email ?? null)
    : null;
  if (adopted) assertClassifiedPreEvaluation(adopted);
  const uploaded = body.files.length > 0 ? await referencedOriginals(db, sessionId, body.files) : [];
  if (!adopted && uploaded.length < 1) throw new HttpError("Upload at least one file", 400);
  const customer = email ? await upsertCustomer(db, email) : await insertCustomerWithoutEmail(db);
  const orderToken = generateOrderToken();
  const priced =
    choice.orderType === "evaluation"
      ? priceServices({
          services: choice.services,
          degreeCount: choice.degreeCount,
          sourceLanguage: null,
          billablePages: null,
        })
      : null;
  const evaluationCents = priced?.evaluationCents ?? null;
  const order = await insertOrder(db, {
    id: sessionId,
    tokenHash: hashOrderToken(orderToken),
    customerId: customer.id,
    orderType: choice.orderType,
    serviceType: choice.orderType === "evaluation" ? "evaluation" : "translation",
    service: choice.service,
    degreeCount: choice.degreeCount,
    includeTranslation: choice.includeTranslation,
    services: choice.services,
    evaluationCents,
    translationCents: evaluationCents == null ? null : 0,
    totalCents: evaluationCents,
    unitPriceCents: priced?.unitPriceCents ?? null,
    utmSource: body.utmSource,
    utmMedium: body.utmMedium,
    utmCampaign: body.utmCampaign,
    gclid: body.gclid,
    landingPath: body.landingPath,
    userId,
  });

  let claimed = false;
  try {
    if (adopted) {
      claimed = await linkPreEvaluationOrder(db, adopted.id, order.id, new Date().toISOString());
      if (!claimed) throw new HttpError("This pre-evaluation was already ordered", 409, "already_ordered");
    }
    const copied = adopted ? await copyPreEvaluationOriginal(db, order.id, adopted) : null;
    const files = copied ? [copied, ...uploaded] : uploaded;
    if (files.length < 1) throw new HttpError("Upload at least one file", 400);
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
  } catch (error) {
    if (adopted) {
      if (claimed) {
        try {
          await releasePreEvaluationOrder(db, adopted.id, order.id, new Date().toISOString());
        } catch {
          console.error("pre-evaluation order claim release failed");
        }
      }
      try {
        await deleteOrder(db, order.id);
      } catch {
        console.error("order discard failed");
      }
    }
    throw error;
  }
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
