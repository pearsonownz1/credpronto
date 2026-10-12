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
import { assertEmail, assertUploadBudget, dedupeUploads, resolveUploadMime, safeFilename } from "./files";
import { serviceDb, uploadObject } from "./storage";
import { generateOrderToken, hashOrderToken } from "./token";
import { evaluationFeeCents, parseOrderChoice } from "./evaluation-price";
import { HttpError } from "./errors";

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

function textField(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

export async function createOrder(request: Request): Promise<{
  orderToken: string;
  orderId: string;
  email: string;
  documentCount: number;
  estimatedCents: number | null;
  sourceLanguage: string | null;
  targetLanguage: string;
}> {
  const form = await request.formData();
  const session = await optionalUser();
  const bodyEmail = form.get("email");
  const { email, userId } = resolveOrderCustomer({
    session: session ? { id: session.id, email: session.email } : null,
    bodyEmail: typeof bodyEmail === "string" ? bodyEmail : null,
  });
  const uploads = [...form.getAll("files"), ...form.getAll("file")].filter(
    (entry): entry is File => entry instanceof File,
  );
  assertUploadBudget(uploads.map((file) => ({ size: file.size })));

  const prepared: Array<{ filename: string; mime: string; bytes: Uint8Array }> = [];
  for (const file of uploads) {
    const mime = resolveUploadMime(file.name, file.type || "");
    if (!mime) throw new HttpError(`Unsupported file type: ${file.name}`, 415);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) throw new HttpError("Empty files are not accepted", 400);
    prepared.push({ filename: file.name || "upload", mime, bytes });
  }
  const files = dedupeUploads(prepared);
  assertUploadBudget(files.map((file) => ({ size: file.bytes.byteLength })));

  const choice = parseOrderChoice({
    orderType: textField(form, "orderType"),
    service: textField(form, "service"),
    degreeCount: textField(form, "degreeCount"),
    includeTranslation: textField(form, "includeTranslation"),
  });

  const db = serviceDb();
  const customer = await upsertCustomer(db, email);
  const orderToken = generateOrderToken();
  const order = await insertOrder(db, {
    tokenHash: hashOrderToken(orderToken),
    customerId: customer.id,
    orderType: choice.orderType,
    serviceType: choice.orderType === "evaluation" ? "evaluation" : "translation",
    service: choice.service,
    degreeCount: choice.degreeCount,
    includeTranslation: choice.includeTranslation,
    evaluationCents:
      choice.service && choice.degreeCount != null
        ? evaluationFeeCents(choice.service, choice.degreeCount)
        : null,
    utmSource: textField(form, "utm_source"),
    utmMedium: textField(form, "utm_medium"),
    utmCampaign: textField(form, "utm_campaign"),
    gclid: textField(form, "gclid"),
    landingPath: textField(form, "landing_path"),
    userId,
  });

  await insertEvent(db, order.id, "upload_started", { fileCount: files.length });
  await storeFiles(db, order.id, files);
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
