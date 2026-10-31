import { browserJson } from "@/lib/api/browser";
import type { ApiResult } from "@/lib/api/types";

/**
 * Signed-in integrations client.
 *
 * Wired to routes that exist today:
 * - GET/POST `/api/me/api-keys`, DELETE `/api/me/api-keys/:id`
 * - PUT `/api/me/webhook`
 * - GET/DELETE `/api/me/billing`, POST `/api/me/billing/setup-intent`
 *
 * Contracts for routes Backend has not shipped. A 404, 405, or 501 becomes
 * `unavailable` and the page shows a coming-soon state. No sample payloads.
 *
 * GET `/api/me/webhook`
 * `{ url: string | null, secret?: string | null, secretLast4: string | null,
 *    lastDelivery: { status, event, at, responseStatus } | null }`
 *
 * POST `/api/me/webhook/test`
 * `{ status, event, at, responseStatus }`
 *
 * GET `/api/me/api-orders`
 * `{ orders: [{ id, externalRef, keyName, keyPrefix, keyLast4, pages, status,
 *    amountCents, currency, placedAt, downloadUrl, viewUrl }] }`
 * `amountCents` is the charged amount. The page never invents a price.
 *
 * Optional fields on routes that already exist:
 * - API key `lastUsedAt` (ISO string or null). Omitted → last used is unknown.
 * - Billing card `expMonth` and `expYear`. Omitted → expiry is unknown.
 */

export const INTEGRATION_ROUTES = {
  keys: "/api/me/api-keys",
  webhook: "/api/me/webhook",
  webhookTest: "/api/me/webhook/test",
  billing: "/api/me/billing",
  setupIntent: "/api/me/billing/setup-intent",
  apiOrders: "/api/me/api-orders",
} as const;

/** Customer-facing webhook chips. */
export const WEBHOOK_EVENTS = [
  "order.quoted",
  "order.preview_ready",
  "order.paid",
  "evaluation.paid",
  "order.completed",
] as const;
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/**
 * Chips the delivery pipeline can post today.
 * The server also emits `order.delivered` and `order.failed`, which are not in this list.
 */
export const LIVE_WEBHOOK_EVENTS = [
  "order.quoted",
  "order.preview_ready",
  "order.paid",
  "evaluation.paid",
  "order.completed",
] as const;

export type ApiKeyMode = "live" | "test";

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
  /** Null when the key has never been used. Ignored when `lastUsedKnown` is false. */
  lastUsedAt: string | null;
  /** False when GET `/api/me/api-keys` omits `lastUsedAt`. */
  lastUsedKnown: boolean;
  revokedAt: string | null;
};

export type RevealedKey = {
  id: string;
  name: string;
  secret: string;
};

export type SavedCard = {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  email?: string | null;
  wallet?: "link" | null;
};

export type WebhookDelivery = {
  status: string;
  event: string;
  at: string;
  responseStatus: number | null;
};

export type WebhookEndpoint = {
  url: string;
  secret: string | null;
  secretLast4: string | null;
  lastDelivery: WebhookDelivery | null;
};

export type ApiOrder = {
  id: string;
  externalRef: string | null;
  keyName: string | null;
  keyPrefix: string | null;
  keyLast4: string | null;
  pages: number | null;
  status: string;
  amountCents: number | null;
  currency: string;
  placedAt: string;
  downloadUrl: string | null;
  viewUrl: string | null;
};

export type Section<T> = { status: "ready"; data: T } | { status: "unavailable" } | { status: "error"; message: string };

export type IntegrationsSnapshot = {
  keys: Section<ApiKeyRecord[]>;
  card: Section<SavedCard | null>;
  webhook: Section<WebhookEndpoint | null>;
  apiOrders: Section<ApiOrder[]>;
};

export type SetupIntentSecret = {
  clientSecret: string;
  customerId: string;
};

export type SavedWebhook = {
  url: string;
  secret: string;
};

export type IntegrationsClient = {
  load(): Promise<ApiResult<IntegrationsSnapshot>>;
  createKey(input: { name: string; mode: ApiKeyMode }): Promise<ApiResult<RevealedKey & ApiKeyRecord>>;
  revokeKey(id: string): Promise<ApiResult<{ id: string; revokedAt: string | null }>>;
  saveWebhook(url: string): Promise<ApiResult<SavedWebhook>>;
  sendTest(): Promise<ApiResult<WebhookDelivery>>;
  createSetupIntent(): Promise<ApiResult<SetupIntentSecret>>;
  loadCard(): Promise<ApiResult<SavedCard | null>>;
  removeCard(): Promise<ApiResult<{ card: null }>>;
};

export function isLiveWebhookEvent(event: string): boolean {
  return (LIVE_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

export function pendingWebhookEvents(): WebhookEventName[] {
  return WEBHOOK_EVENTS.filter((event) => !isLiveWebhookEvent(event));
}

export function isUnavailableStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

export function toSection<T>(result: ApiResult<T>, missingMeansUnavailable: boolean): Section<T> {
  if (result.ok) return { status: "ready", data: result.data };
  if (missingMeansUnavailable && isUnavailableStatus(result.status)) return { status: "unavailable" };
  return { status: "error", message: result.error };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function unexpected(): ApiResult<never> {
  return { ok: false, status: 502, error: "Unexpected response" };
}

function lastUsed(row: Record<string, unknown>): { known: boolean; at: string | null } | null {
  if (!("lastUsedAt" in row)) return { known: false, at: null };
  if (row.lastUsedAt == null) return { known: true, at: null };
  const at = text(row.lastUsedAt);
  return at ? { known: true, at } : null;
}

function nullableText(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function wholeNumber(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

export function parseApiKeys(body: unknown): ApiKeyRecord[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { keys?: unknown }).keys)) return null;
  const keys: ApiKeyRecord[] = [];
  for (const entry of (body as { keys: unknown[] }).keys) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const id = text(row.id);
    const name = text(row.name);
    const prefix = text(row.prefix);
    const last4 = text(row.last4);
    const createdAt = text(row.createdAt);
    const used = lastUsed(row);
    if (!id || !name || !prefix || !last4 || !createdAt || !used) return null;
    const revoked = row.revokedAt;
    keys.push({
      id,
      name,
      prefix,
      last4,
      createdAt,
      lastUsedAt: used.at,
      lastUsedKnown: used.known,
      revokedAt: revoked == null ? null : text(revoked),
    });
  }
  return keys;
}

function cardExpiry(card: Record<string, unknown>): { expMonth: number | null; expYear: number | null } {
  const month = card.expMonth;
  const year = card.expYear;
  if (typeof month !== "number" || typeof year !== "number") return { expMonth: null, expYear: null };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { expMonth: null, expYear: null };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { expMonth: null, expYear: null };
  return { expMonth: month, expYear: year };
}

export function parseBillingCard(body: unknown): { card: SavedCard | null } | null {
  if (!body || typeof body !== "object" || !("card" in body)) return null;
  const card = (body as { card: unknown }).card;
  if (card == null) return { card: null };
  if (typeof card !== "object") return null;
  const record = card as Record<string, unknown>;
  const brand = text(record.brand);
  const last4 = text(record.last4);
  if (!brand || !last4) return null;
  const email = typeof record.email === "string" && record.email.trim() ? record.email.trim() : null;
  const wallet = record.wallet === "link" ? "link" : null;
  return {
    card: {
      brand,
      last4,
      ...cardExpiry(record),
      ...(email ? { email } : {}),
      ...(wallet ? { wallet } : {}),
    },
  };
}

export function parseCreatedKey(body: unknown): (RevealedKey & ApiKeyRecord) | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const id = text(row.id);
  const name = text(row.name);
  const prefix = text(row.prefix);
  const last4 = text(row.last4);
  const secret = text(row.secret);
  const createdAt = text(row.createdAt);
  const used = lastUsed(row);
  if (!id || !name || !prefix || !last4 || !secret || !createdAt || !used) return null;
  return {
    id,
    name,
    prefix,
    last4,
    secret,
    createdAt,
    lastUsedAt: used.at,
    lastUsedKnown: used.known,
    revokedAt: null,
  };
}

export function parseSavedWebhook(body: unknown): SavedWebhook | null {
  if (!body || typeof body !== "object") return null;
  const url = text((body as { url?: unknown }).url);
  const secret = text((body as { secret?: unknown }).secret);
  if (!url || !secret) return null;
  return { url, secret };
}

export function parseSetupIntent(body: unknown): SetupIntentSecret | null {
  if (!body || typeof body !== "object") return null;
  const clientSecret = text((body as { clientSecret?: unknown }).clientSecret);
  const customerId = text((body as { customerId?: unknown }).customerId);
  if (!clientSecret || !customerId) return null;
  return { clientSecret, customerId };
}

function parseDelivery(value: unknown): WebhookDelivery | null | undefined {
  if (value == null) return null;
  if (typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const status = text(row.status);
  const event = text(row.event);
  const at = text(row.at);
  if (!status || !event || !at) return undefined;
  const responseStatus = row.responseStatus;
  if (responseStatus != null && (typeof responseStatus !== "number" || !Number.isInteger(responseStatus))) return undefined;
  return { status, event, at, responseStatus: responseStatus ?? null };
}

/** `endpoint` is null when the account has not saved a URL. */
export function parseWebhookEndpoint(body: unknown): { endpoint: WebhookEndpoint | null } | null {
  if (!body || typeof body !== "object" || !("url" in body)) return null;
  const row = body as Record<string, unknown>;
  if (row.url == null) return { endpoint: null };
  const url = text(row.url);
  if (!url) return null;
  const secret = "secret" in row ? nullableText(row.secret) : null;
  const secretLast4 = "secretLast4" in row ? nullableText(row.secretLast4) : null;
  if (secret === undefined || secretLast4 === undefined) return null;
  const lastDelivery = "lastDelivery" in row ? parseDelivery(row.lastDelivery) : null;
  if (lastDelivery === undefined) return null;
  return { endpoint: { url, secret, secretLast4, lastDelivery } };
}

export function parseTestDelivery(body: unknown): WebhookDelivery | null {
  const delivery = parseDelivery(body);
  return delivery ?? null;
}

export function parseApiOrders(body: unknown): ApiOrder[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { orders?: unknown }).orders)) return null;
  const orders: ApiOrder[] = [];
  for (const entry of (body as { orders: unknown[] }).orders) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const id = text(row.id);
    const status = text(row.status);
    const placedAt = text(row.placedAt);
    const externalRef = nullableText(row.externalRef);
    const keyName = nullableText(row.keyName);
    const keyPrefix = nullableText(row.keyPrefix);
    const keyLast4 = nullableText(row.keyLast4);
    const pages = wholeNumber(row.pages);
    const amountCents = wholeNumber(row.amountCents);
    const downloadUrl = nullableText(row.downloadUrl);
    const viewUrl = nullableText(row.viewUrl);
    const currency = row.currency == null ? "" : text(row.currency);
    if (
      !id ||
      !status ||
      !placedAt ||
      externalRef === undefined ||
      keyName === undefined ||
      keyPrefix === undefined ||
      keyLast4 === undefined ||
      pages === undefined ||
      amountCents === undefined ||
      downloadUrl === undefined ||
      viewUrl === undefined ||
      currency == null
    ) {
      return null;
    }
    orders.push({
      id,
      externalRef,
      keyName,
      keyPrefix,
      keyLast4,
      pages,
      status,
      amountCents,
      currency,
      placedAt,
      downloadUrl,
      viewUrl,
    });
  }
  return orders;
}

async function readJsonSection<T>(
  path: string,
  missingMeansUnavailable: boolean,
  parse: (body: unknown) => { value: T } | null,
): Promise<Section<T>> {
  const result = await browserJson<unknown>(path);
  if (!result.ok) return toSection(result, missingMeansUnavailable);
  const parsed = parse(result.data);
  if (!parsed) return { status: "error", message: "Unexpected response" };
  return { status: "ready", data: parsed.value };
}

export function createLiveIntegrationsClient(): IntegrationsClient {
  return {
    async load() {
      const [keys, card, webhook, apiOrders] = await Promise.all([
        readJsonSection(INTEGRATION_ROUTES.keys, false, (body) => {
          const value = parseApiKeys(body);
          return value == null ? null : { value };
        }),
        readJsonSection(INTEGRATION_ROUTES.billing, false, (body) => {
          const parsed = parseBillingCard(body);
          return parsed ? { value: parsed.card } : null;
        }),
        readJsonSection(INTEGRATION_ROUTES.webhook, true, (body) => {
          const parsed = parseWebhookEndpoint(body);
          return parsed ? { value: parsed.endpoint } : null;
        }),
        readJsonSection(INTEGRATION_ROUTES.apiOrders, true, (body) => {
          const value = parseApiOrders(body);
          return value == null ? null : { value };
        }),
      ]);
      return { ok: true, status: 200, data: { keys, card, webhook, apiOrders } };
    },
    async createKey(input) {
      const result = await browserJson<unknown>(INTEGRATION_ROUTES.keys, {
        method: "POST",
        body: JSON.stringify({ name: input.name, mode: input.mode }),
      });
      if (!result.ok) return result;
      const created = parseCreatedKey(result.data);
      if (!created) return unexpected();
      return { ok: true, status: result.status, data: created };
    },
    async revokeKey(id) {
      const result = await browserJson<unknown>(`${INTEGRATION_ROUTES.keys}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!result.ok) return result;
      if (!result.data || typeof result.data !== "object") return unexpected();
      const row = result.data as { id?: unknown; revokedAt?: unknown };
      const revokedId = text(row.id);
      if (!revokedId) return unexpected();
      return { ok: true, status: result.status, data: { id: revokedId, revokedAt: text(row.revokedAt) } };
    },
    async saveWebhook(url) {
      const result = await browserJson<unknown>(INTEGRATION_ROUTES.webhook, {
        method: "PUT",
        body: JSON.stringify({ url }),
      });
      if (!result.ok) return result;
      const saved = parseSavedWebhook(result.data);
      if (!saved) return unexpected();
      return { ok: true, status: result.status, data: saved };
    },
    async sendTest() {
      const result = await browserJson<unknown>(INTEGRATION_ROUTES.webhookTest, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!result.ok) return result;
      const delivery = parseTestDelivery(result.data);
      if (!delivery) return unexpected();
      return { ok: true, status: result.status, data: delivery };
    },
    async createSetupIntent() {
      const result = await browserJson<unknown>(INTEGRATION_ROUTES.setupIntent, { method: "POST" });
      if (!result.ok) return result;
      const secret = parseSetupIntent(result.data);
      if (!secret) return unexpected();
      return { ok: true, status: result.status, data: secret };
    },
    async loadCard() {
      const result = await browserJson<unknown>(INTEGRATION_ROUTES.billing);
      if (!result.ok) return result;
      const parsed = parseBillingCard(result.data);
      if (!parsed) return unexpected();
      return { ok: true, status: result.status, data: parsed.card };
    },
    async removeCard() {
      const result = await browserJson<unknown>(INTEGRATION_ROUTES.billing, { method: "DELETE" });
      if (!result.ok) return result;
      const parsed = parseBillingCard(result.data);
      if (!parsed || parsed.card !== null) return unexpected();
      return { ok: true, status: result.status, data: { card: null } };
    },
  };
}

const liveClient = createLiveIntegrationsClient();

export function getIntegrationsClient(): IntegrationsClient {
  return liveClient;
}
