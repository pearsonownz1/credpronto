import type { Db } from "./storage";
import { storedApiKeyPrefix, type ApiKeyPrefix } from "./api-key";
import type { WebhookEvent } from "./outbound-webhook";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

const API_KEY_COLUMNS = "id, user_id, name, prefix, last4, created_at, last_used_at, revoked_at";

export type ApiKeyRow = {
  id: string;
  userId: string;
  name: string;
  prefix: ApiKeyPrefix;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type WebhookEndpointRow = {
  id: string;
  userId: string;
  url: string;
  signingSecret: string;
};

export type WebhookDeliveryRow = {
  id: string;
  endpointId: string;
  orderId: string;
  event: WebhookEvent;
  attempt: number;
  status: "pending" | "succeeded" | "failed";
  responseStatus: number | null;
  nextRetryAt: string | null;
};

type Row = Record<string, unknown>;

function mapKey(row: Row): ApiKeyRow {
  const prefix = storedApiKeyPrefix(row.prefix);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    prefix,
    last4: String(row.last4),
    createdAt: String(row.created_at),
    lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
    revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
  };
}

export async function insertApiKey(
  db: Db,
  input: { userId: string; name: string; prefix: ApiKeyPrefix; keyHash: string; last4: string },
): Promise<ApiKeyRow> {
  const { data, error } = await db
    .from("api_keys")
    .insert({
      user_id: input.userId,
      name: input.name,
      prefix: input.prefix,
      key_hash: input.keyHash,
      last4: input.last4,
    })
    .select(API_KEY_COLUMNS)
    .single();
  fail(error);
  return mapKey(data as Row);
}

export async function listApiKeys(db: Db, userId: string): Promise<ApiKeyRow[]> {
  const { data, error } = await db
    .from("api_keys")
    .select(API_KEY_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  fail(error);
  return ((data ?? []) as Row[]).map(mapKey);
}

export async function revokeApiKey(db: Db, userId: string, id: string): Promise<ApiKeyRow | null> {
  const existing = await db
    .from("api_keys")
    .select(API_KEY_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  fail(existing.error);
  if (!existing.data) return null;
  const row = mapKey(existing.data as Row);
  if (row.revokedAt) return row;
  const revokedAt = new Date().toISOString();
  const { error } = await db.from("api_keys").update({ revoked_at: revokedAt }).eq("id", id);
  fail(error);
  return { ...row, revokedAt };
}

export async function findActiveApiKey(db: Db, keyHash: string): Promise<ApiKeyRow | null> {
  const { data, error } = await db
    .from("api_keys")
    .select(API_KEY_COLUMNS)
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();
  fail(error);
  return data ? mapKey(data as Row) : null;
}

export async function touchApiKeyLastUsed(db: Db, id: string, at = new Date().toISOString()): Promise<void> {
  const { error } = await db.from("api_keys").update({ last_used_at: at }).eq("id", id).is("revoked_at", null);
  fail(error);
}

export async function upsertWebhookEndpoint(
  db: Db,
  input: { userId: string; url: string; signingSecret: string },
): Promise<WebhookEndpointRow> {
  const { data, error } = await db
    .from("webhook_endpoints")
    .upsert(
      {
        user_id: input.userId,
        url: input.url,
        signing_secret: input.signingSecret,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("id, user_id, url, signing_secret")
    .single();
  fail(error);
  const row = data as Row;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    url: String(row.url),
    signingSecret: String(row.signing_secret),
  };
}

export async function latestWebhookDelivery(
  db: Db,
  endpointId: string,
): Promise<{ status: string; event: string; at: string; responseStatus: number | null } | null> {
  const { data, error } = await db
    .from("webhook_deliveries")
    .select("event, status, response_status, created_at")
    .eq("endpoint_id", endpointId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  const row = data as Row;
  const status = typeof row.status === "string" ? row.status : "";
  const event = typeof row.event === "string" ? row.event : "";
  const at = typeof row.created_at === "string" ? row.created_at : "";
  if (!status || !event || !at) return null;
  return {
    status,
    event,
    at,
    responseStatus: typeof row.response_status === "number" ? row.response_status : null,
  };
}

export async function webhookEndpointForUser(db: Db, userId: string): Promise<WebhookEndpointRow | null> {
  const { data, error } = await db
    .from("webhook_endpoints")
    .select("id, user_id, url, signing_secret")
    .eq("user_id", userId)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  const row = data as Row;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    url: String(row.url),
    signingSecret: String(row.signing_secret),
  };
}

export async function insertWebhookDelivery(
  db: Db,
  input: {
    endpointId: string;
    orderId: string | null;
    event: WebhookEvent;
    attempt: number;
    status: "pending" | "succeeded" | "failed";
    responseStatus: number | null;
    nextRetryAt: string | null;
  },
): Promise<void> {
  const { error } = await db.from("webhook_deliveries").insert({
    endpoint_id: input.endpointId,
    order_id: input.orderId,
    event: input.event,
    attempt: input.attempt,
    status: input.status,
    response_status: input.responseStatus,
    next_retry_at: input.nextRetryAt,
  });
  fail(error);
}

export async function dueWebhookDeliveries(db: Db, limit: number): Promise<WebhookDeliveryRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("webhook_deliveries")
    .select("id, endpoint_id, order_id, event, attempt, status, response_status, next_retry_at")
    .eq("status", "pending")
    .lte("next_retry_at", now)
    .order("next_retry_at", { ascending: true })
    .limit(limit);
  fail(error);
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    endpointId: String(row.endpoint_id),
    orderId: String(row.order_id),
    event: String(row.event) as WebhookEvent,
    attempt: Number(row.attempt),
    status: "pending",
    responseStatus: typeof row.response_status === "number" ? row.response_status : null,
    nextRetryAt: typeof row.next_retry_at === "string" ? row.next_retry_at : null,
  }));
}

export async function finishWebhookDelivery(
  db: Db,
  id: string,
  patch: { status: "pending" | "succeeded" | "failed"; responseStatus: number | null; nextRetryAt: string | null; attempt: number },
): Promise<void> {
  const { error } = await db
    .from("webhook_deliveries")
    .update({
      status: patch.status,
      response_status: patch.responseStatus,
      next_retry_at: patch.nextRetryAt,
      attempt: patch.attempt,
    })
    .eq("id", id);
  fail(error);
}

export async function findBillingCard(
  db: Db,
  userId: string,
): Promise<{ customerId: string; paymentMethodId: string } | null> {
  const { data, error } = await db
    .from("billing_customers")
    .select("stripe_customer_id, payment_method_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || /billing_customers/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  const row = data as Row | null;
  const paymentMethodId = typeof row?.payment_method_id === "string" ? row.payment_method_id : "";
  const customerId = typeof row?.stripe_customer_id === "string" ? row.stripe_customer_id : "";
  if (!paymentMethodId || !customerId) return null;
  return { customerId, paymentMethodId };
}

export type BillingTerms = "card" | "net";

export type BillingCustomerRow = {
  userId: string;
  stripeCustomerId: string;
  paymentMethodId: string | null;
  brand: string | null;
  last4: string | null;
  terms: BillingTerms;
  openInvoiceId: string | null;
};

export function billingTerms(value: unknown): BillingTerms {
  return value === "net" ? "net" : "card";
}

function mapBilling(row: Row): BillingCustomerRow {
  return {
    userId: String(row.user_id),
    stripeCustomerId: String(row.stripe_customer_id),
    paymentMethodId: typeof row.payment_method_id === "string" ? row.payment_method_id : null,
    brand: typeof row.brand === "string" ? row.brand : null,
    last4: typeof row.last4 === "string" ? row.last4 : null,
    terms: billingTerms(row.terms),
    openInvoiceId: typeof row.open_invoice_id === "string" ? row.open_invoice_id : null,
  };
}

export async function billingCustomerForUser(db: Db, userId: string): Promise<BillingCustomerRow | null> {
  const { data, error } = await db.from("billing_customers").select("*").eq("user_id", userId).maybeSingle();
  if (error) {
    if (error.code === "42P01" || /billing_customers/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapBilling(data as Row) : null;
}

export async function billingUserForStripeCustomer(db: Db, stripeCustomerId: string): Promise<string | null> {
  const { data, error } = await db
    .from("billing_customers")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01" || /billing_customers/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data?.user_id ? String(data.user_id) : null;
}

export async function insertBillingCustomer(db: Db, userId: string, stripeCustomerId: string): Promise<void> {
  const { error } = await db.from("billing_customers").insert({
    user_id: userId,
    stripe_customer_id: stripeCustomerId,
  });
  if (error?.code === "23505") return;
  fail(error);
}

export async function saveBillingMethod(
  db: Db,
  userId: string,
  input: { paymentMethodId: string; brand: string; last4: string },
): Promise<void> {
  const { error } = await db
    .from("billing_customers")
    .update({
      payment_method_id: input.paymentMethodId,
      brand: input.brand,
      last4: input.last4,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  fail(error);
}

export async function setBillingTerms(db: Db, userId: string, terms: BillingTerms): Promise<boolean> {
  const { data, error } = await db
    .from("billing_customers")
    .update({ terms, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("user_id");
  fail(error);
  return ((data ?? []) as Row[]).length > 0;
}

export async function saveOpenInvoiceId(db: Db, userId: string, invoiceId: string): Promise<void> {
  const { error } = await db
    .from("billing_customers")
    .update({ open_invoice_id: invoiceId, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  fail(error);
}

export async function clearBillingMethod(db: Db, userId: string): Promise<void> {
  const { error } = await db
    .from("billing_customers")
    .update({
      payment_method_id: null,
      brand: null,
      last4: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  fail(error);
}

export async function orderByExternalRef(db: Db, userId: string, externalRef: string): Promise<string | null> {
  const { data, error } = await db
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("external_ref", externalRef)
    .maybeSingle();
  fail(error);
  return data?.id ? String(data.id) : null;
}
