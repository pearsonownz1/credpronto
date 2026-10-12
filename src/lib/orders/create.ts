import { randomUUID } from "node:crypto";
import { ORIGINALS_BUCKET } from "./constants";
import {
  insertDocument,
  insertEvent,
  insertOrder,
  upsertCustomer,
  type Db,
} from "./db";
import { assertEmail, assertUploadBudget, resolveUploadMime, safeFilename } from "./files";
import { serviceDb, uploadObject } from "./storage";
import { generateOrderToken, hashOrderToken } from "./token";
import { HttpError } from "./errors";

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
}> {
  const form = await request.formData();
  const email = assertEmail(String(form.get("email") ?? ""));
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
  assertUploadBudget(prepared.map((file) => ({ size: file.bytes.byteLength })));

  const db = serviceDb();
  const customer = await upsertCustomer(db, email);
  const orderToken = generateOrderToken();
  const order = await insertOrder(db, {
    tokenHash: hashOrderToken(orderToken),
    customerId: customer.id,
    utmSource: textField(form, "utm_source"),
    utmMedium: textField(form, "utm_medium"),
    utmCampaign: textField(form, "utm_campaign"),
    gclid: textField(form, "gclid"),
    landingPath: textField(form, "landing_path"),
  });

  await insertEvent(db, order.id, "upload_started", { fileCount: prepared.length });
  await storeFiles(db, order.id, prepared);
  await insertEvent(db, order.id, "upload_done", { fileCount: prepared.length });
  await insertEvent(db, order.id, "staff_notified", { channel: "event" });

  return { orderToken, orderId: order.id, email };
}

async function storeFiles(
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
