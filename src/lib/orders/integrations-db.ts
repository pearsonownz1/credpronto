import type { Db } from "./storage";
import type { ApiKeyPrefix } from "./api-key";
import type { WebhookEvent } from "./outbound-webhook";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export type ApiKeyRow = {
  id: string;
  userId: string;
  name: string;
  prefix: ApiKeyPrefix;
  last4: string;
  createdAt: string;
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
  const prefix = row.prefix === "cp_live_" ? "cp_live_" : "cp_test_";
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    prefix,
    last4: String(row.last4),
    createdAt: String(row.created_at),
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
    .select("id, user_id, name, prefix, last4, created_at, revoked_at")
    .single();
  fail(error);
  return mapKey(data as Row);
}

export async function listApiKeys(db: Db, userId: string): Promise<ApiKeyRow[]> {
  const { data, error } = await db
    .from("api_keys")
    .select("id, user_id, name, prefix, last4, created_at, revoked_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  fail(error);
  return ((data ?? []) as Row[]).map(mapKey);
}

export async function revokeApiKey(db: Db, userId: string, id: string): Promise<ApiKeyRow | null> {
  const existing = await db
    .from("api_keys")
    .select("id, user_id, name, prefix, last4, created_at, revoked_at")
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
    .select("id, user_id, name, prefix, last4, created_at, revoked_at")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .maybeSingle();
  fail(error);
  return data ? mapKey(data as Row) : null;
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
    orderId: string;
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
