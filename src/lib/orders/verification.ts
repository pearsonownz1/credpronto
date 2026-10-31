import { randomBytes } from "node:crypto";
import { clientIp } from "@/lib/contact/rate-limit";
import { DOWNLOAD_URL_SECONDS, FINALS_BUCKET } from "./constants";
import { HttpError } from "./errors";
import { stampVerificationQr } from "./pdf/verify-stamp";
import { requireStaff } from "./staff";
import { serviceDb, signedObjectUrl, type Db } from "./storage";
import { hashOrderToken, isOrderId } from "./token";
import { consumeVerifyRate } from "./verify-rate-limit";

export type DocumentType = "translation" | "evaluation";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const CERTIFIED_TRANSLATION = /\/certified-translation-v\d+\.pdf$/;
const EVALUATION_OBJECT = /(?:^|\/)(?:evaluation-v\d+|evaluation|[a-z_]+-evaluation)\.pdf$/;

export type PublicVerification =
  | { status: "not_found" }
  | {
      status: "revoked";
      type: DocumentType;
      issuedAt: string;
      reference: string;
    }
  | {
      status: "valid";
      type: DocumentType;
      issuedAt: string;
      documentUrl: string;
      reference: string;
    };

export type VerificationChange = {
  status: "valid" | "revoked";
  type: DocumentType;
  issuedAt: string;
  reference: string;
};

type LinkRow = {
  token: string;
  order_id: string;
  document_type: string;
  created_at: string;
  revoked_at: string | null;
};

type OrderPathRow = {
  id: string;
  final_translation_path: string | null;
  certification_path: string | null;
};

type DeliveryPathRow = {
  final_path: string | null;
  certification_path: string | null;
};

/** 32 bytes from a CSPRNG, base64url. 256 bits, above the 128-bit floor. */
export function generateVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isVerificationToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** The order id. It is the reference printed for staff and on the certificate. */
export function orderReference(orderId: string): string {
  return orderId;
}

export function finishedPdfPath(input: {
  documentType: DocumentType;
  order: { finalTranslationPath: string | null; certificationPath: string | null };
  delivery: { finalPath: string | null; certificationPath: string | null } | null;
}): string | null {
  const candidates = [
    input.delivery?.finalPath,
    input.delivery?.certificationPath,
    input.order.finalTranslationPath,
    input.order.certificationPath,
  ];
  if (input.documentType === "evaluation") {
    return candidates.find((path) => path && isEvaluationObject(path)) ?? null;
  }
  const certified = candidates.find((path) => path && CERTIFIED_TRANSLATION.test(path));
  if (certified) return certified;
  return candidates.find((path) => path && !isEvaluationObject(path)) ?? null;
}

function isEvaluationObject(path: string): boolean {
  return EVALUATION_OBJECT.test(path);
}

/**
 * Create or reuse the active link, then stamp its verify URL onto the PDF.
 * A later final for the same order and type keeps the same token until staff revoke it.
 */
export async function stampFinishedPdf(
  db: Db,
  bytes: Uint8Array,
  input: { orderId: string; documentType: DocumentType },
): Promise<Uint8Array> {
  const link = await issueVerificationLink(db, input);
  return stampVerificationQr(bytes, link.token);
}

export async function publicVerification(request: Request, rawToken: string): Promise<PublicVerification> {
  const ipDecision = consumeVerifyRate(`ip:${clientIp(request)}`);
  if (!ipDecision.allowed) {
    throw new HttpError("Too many requests", 429, "rate_limited", {
      retryAfterSeconds: ipDecision.retryAfterSeconds,
    });
  }
  const token = rawToken.trim();
  if (!isVerificationToken(token)) return { status: "not_found" };
  const tokenDecision = consumeVerifyRate(`token:${hashOrderToken(token)}`);
  if (!tokenDecision.allowed) {
    throw new HttpError("Too many requests", 429, "rate_limited", {
      retryAfterSeconds: tokenDecision.retryAfterSeconds,
    });
  }
  return readVerification(serviceDb(), token);
}

export async function readVerification(db: Db, token: string): Promise<PublicVerification> {
  if (!isVerificationToken(token)) return { status: "not_found" };
  const link = await findLinkByToken(db, token);
  if (!link) return { status: "not_found" };
  return verificationFromLink(db, link);
}

/** Certificates already issued for this order. Empty issuance is `not_found`. */
export async function orderVerification(db: Db, orderId: string): Promise<PublicVerification[]> {
  const found: PublicVerification[] = [];
  for (const type of ["translation", "evaluation"] as const) {
    const rows = await linksForOrder(db, orderId, type);
    const active = rows.find((row) => row.revoked_at == null);
    const link = active ?? latestRevoked(rows);
    if (!link) continue;
    found.push(await verificationFromLink(db, link));
  }
  return found.length > 0 ? found : [{ status: "not_found" }];
}

async function verificationFromLink(db: Db, link: LinkRow): Promise<PublicVerification> {
  const type = asDocumentType(link.document_type);
  if (!type) return { status: "not_found" };
  const issuedAt = isoTimestamp(link.created_at);
  const reference = orderReference(link.order_id);
  if (link.revoked_at) return { status: "revoked", type, issuedAt, reference };

  const order = await orderPaths(db, link.order_id);
  if (!order) return { status: "not_found" };
  const delivery = await deliveryPaths(db, link.order_id);
  const path = finishedPdfPath({
    documentType: type,
    order: {
      finalTranslationPath: order.final_translation_path,
      certificationPath: order.certification_path,
    },
    delivery: delivery
      ? { finalPath: delivery.final_path, certificationPath: delivery.certification_path }
      : null,
  });
  if (!path) throw new HttpError("Document is not available", 503);
  // No download filename: the signed URL is the PDF itself, so a browser can
  // display it and the visitor can save it.
  const documentUrl = await signedObjectUrl(db, FINALS_BUCKET, path, DOWNLOAD_URL_SECONDS);
  return { status: "valid", type, issuedAt, documentUrl, reference };
}

export async function setVerificationRevoked(orderId: string, body: unknown): Promise<VerificationChange> {
  const change = parseVerificationChange(body);
  const { db, userId } = await requireStaff();
  if (!isOrderId(orderId)) throw new HttpError("Order not found", 404);
  const order = await orderPaths(db, orderId);
  if (!order) throw new HttpError("Order not found", 404);

  const rows = await linksForOrder(db, orderId, change.type);
  const active = rows.find((row) => row.revoked_at == null) ?? null;
  if (!change.revoked) {
    if (active) return changeBody("valid", change.type, active);
    const latest = latestRevoked(rows);
    if (!latest) throw new HttpError("There is no verification link", 404);
    await updateLink(db, latest.token, { revoked_at: null, revoked_by: null });
    return changeBody("valid", change.type, { ...latest, revoked_at: null });
  }
  if (!active) throw new HttpError("There is no active verification link", 404);
  const revokedAt = new Date().toISOString();
  await updateLink(db, active.token, { revoked_at: revokedAt, revoked_by: userId });
  return changeBody("revoked", change.type, { ...active, revoked_at: revokedAt });
}

export function parseVerificationChange(body: unknown): { type: DocumentType; revoked: boolean } {
  if (!body || typeof body !== "object") throw new HttpError("Expected a JSON body", 400);
  const type = (body as { type?: unknown }).type;
  const revoked = (body as { revoked?: unknown }).revoked;
  if (type !== "translation" && type !== "evaluation") {
    throw new HttpError("type must be translation or evaluation", 400);
  }
  if (typeof revoked !== "boolean") throw new HttpError("revoked must be true or false", 400);
  return { type, revoked };
}

async function issueVerificationLink(
  db: Db,
  input: { orderId: string; documentType: DocumentType },
): Promise<LinkRow> {
  const existing = await linksForOrder(db, input.orderId, input.documentType);
  const active = existing.find((row) => row.revoked_at == null);
  if (active) return active;

  const token = generateVerificationToken();
  const inserted = await db.from("verification_links").insert({
    token,
    order_id: input.orderId,
    document_type: input.documentType,
  });
  if (inserted.error && inserted.error.code !== "23505") {
    throw new Error("Could not save the verification link");
  }
  const rows = await linksForOrder(db, input.orderId, input.documentType);
  const saved = rows.find((row) => row.revoked_at == null);
  if (!saved) throw new Error("Could not save the verification link");
  return saved;
}

async function findLinkByToken(db: Db, token: string): Promise<LinkRow | null> {
  const { data, error } = await db
    .from("verification_links")
    .select("token, order_id, document_type, created_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error("Could not read the verification link");
  return asLink(data);
}

async function linksForOrder(db: Db, orderId: string, documentType: DocumentType): Promise<LinkRow[]> {
  const { data, error } = await db
    .from("verification_links")
    .select("token, order_id, document_type, created_at, revoked_at")
    .eq("order_id", orderId)
    .eq("document_type", documentType);
  if (error) throw new Error("Could not read the verification link");
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const link = asLink(row);
    return link ? [link] : [];
  });
}

async function orderPaths(db: Db, orderId: string): Promise<OrderPathRow | null> {
  const { data, error } = await db
    .from("orders")
    .select("id, final_translation_path, certification_path")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error("Could not read the order");
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    final_translation_path: nullableString(row.final_translation_path),
    certification_path: nullableString(row.certification_path),
  };
}

async function deliveryPaths(db: Db, orderId: string): Promise<DeliveryPathRow | null> {
  const { data, error } = await db
    .from("deliveries")
    .select("final_path, certification_path")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error("Could not read the delivery");
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return {
    final_path: nullableString(row.final_path),
    certification_path: nullableString(row.certification_path),
  };
}

async function updateLink(db: Db, token: string, patch: { revoked_at: string | null; revoked_by: string | null }) {
  const { error } = await db.from("verification_links").update(patch).eq("token", token);
  if (error) throw new Error("Could not update the verification link");
}

function changeBody(status: "valid" | "revoked", type: DocumentType, link: LinkRow): VerificationChange {
  return {
    status,
    type,
    issuedAt: isoTimestamp(link.created_at),
    reference: orderReference(link.order_id),
  };
}

function latestRevoked(rows: LinkRow[]): LinkRow | null {
  return rows
    .filter((row) => row.revoked_at)
    .sort((a, b) => String(b.revoked_at).localeCompare(String(a.revoked_at)))[0] ?? null;
}

function asDocumentType(value: string): DocumentType | null {
  if (value === "translation" || value === "evaluation") return value;
  return null;
}

function asLink(value: unknown): LinkRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.token !== "string" || typeof row.order_id !== "string" || typeof row.document_type !== "string") {
    return null;
  }
  if (typeof row.created_at !== "string") return null;
  return {
    token: row.token,
    order_id: row.order_id,
    document_type: row.document_type,
    created_at: row.created_at,
    revoked_at: nullableString(row.revoked_at),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isoTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Verification link has no issue date");
  return date.toISOString();
}
