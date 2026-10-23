import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/orders/errors";
import { assertEmail } from "@/lib/orders/files";
import { insertEvent, insertOrder, upsertCustomer } from "@/lib/orders/db";
import { storeFiles } from "@/lib/orders/create";
import type { Db } from "@/lib/orders/storage";
import { generateOrderToken, hashOrderToken } from "@/lib/orders/token";
import { assertClioFileBudget } from "./documents";
import type { ClioRegion } from "./regions";
import type { ClioStore } from "./types";

export async function accountEmail(db: Db, userId: string): Promise<string> {
  const admin = db.auth?.admin;
  if (!admin?.getUserById) throw new HttpError("Could not read the account email", 503);
  const { data, error } = await admin.getUserById(userId);
  if (error || !data.user?.email) throw new HttpError("Could not read the account email", 503);
  return assertEmail(data.user.email);
}

export async function createLinkedTranslationOrder(
  db: Db,
  store: ClioStore,
  input: {
    userId: string;
    email: string;
    region: ClioRegion;
    matterId: string;
    documentIds: string[];
    files: Array<{ filename: string; mime: string; bytes: Uint8Array }>;
  },
): Promise<{ orderId: string; orderToken: string }> {
  assertClioFileBudget(input.files);
  const customer = await upsertCustomer(db, assertEmail(input.email));
  const orderToken = generateOrderToken();
  const order = await insertOrder(db, {
    tokenHash: hashOrderToken(orderToken),
    customerId: customer.id,
    orderType: "translation",
    serviceType: "translation",
    service: null,
    includeTranslation: false,
    services: ["translation"],
    utmSource: "clio",
    utmMedium: "custom_action",
    utmCampaign: null,
    gclid: null,
    landingPath: "/integrations/clio/translate",
    userId: input.userId,
  });
  await insertEvent(db, order.id, "upload_started", { fileCount: input.files.length, source: "clio" });
  await storeFiles(db, order.id, input.files);
  await insertEvent(db, order.id, "upload_done", { fileCount: input.files.length });
  await insertEvent(db, order.id, "staff_notified", { channel: "event" });
  await store.putMatterOrder({
    orderId: order.id,
    userId: input.userId,
    region: input.region,
    matterId: input.matterId,
    documentIds: input.documentIds,
    uploadStatus: "pending",
    uploadError: null,
    clioDocumentId: null,
    uploadedAt: null,
  });
  return { orderId: order.id, orderToken };
}

export function newHandoffId(): string {
  return randomUUID();
}
