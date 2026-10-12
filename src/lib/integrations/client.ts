import { browserJson } from "@/lib/api/browser";
import type { ApiResult } from "@/lib/api/types";

/**
 * The only module that calls the signed-in integrations routes in docs/api.md:
 * `/api/me/api-keys`, `/api/me/webhook`, and `/api/me/billing`.
 */

export const WEBHOOK_EVENTS = ["order.quoted", "order.delivered", "order.failed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type ApiKeyMode = "live" | "test";

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
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
};

export type IntegrationsSnapshot = {
  keys: ApiKeyRecord[];
  card: SavedCard | null;
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
  createSetupIntent(): Promise<ApiResult<SetupIntentSecret>>;
  loadCard(): Promise<ApiResult<SavedCard | null>>;
  removeCard(): Promise<ApiResult<{ card: null }>>;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function unexpected(): ApiResult<never> {
  return { ok: false, status: 502, error: "Unexpected response" };
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
    if (!id || !name || !prefix || !last4 || !createdAt) return null;
    const revoked = row.revokedAt;
    keys.push({
      id,
      name,
      prefix,
      last4,
      createdAt,
      revokedAt: revoked == null ? null : text(revoked),
    });
  }
  return keys;
}

export function parseBillingCard(body: unknown): { card: SavedCard | null } | null {
  if (!body || typeof body !== "object" || !("card" in body)) return null;
  const card = (body as { card: unknown }).card;
  if (card == null) return { card: null };
  if (typeof card !== "object") return null;
  const brand = text((card as { brand?: unknown }).brand);
  const last4 = text((card as { last4?: unknown }).last4);
  if (!brand || !last4) return null;
  return { card: { brand, last4 } };
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
  if (!id || !name || !prefix || !last4 || !secret || !createdAt) return null;
  return { id, name, prefix, last4, secret, createdAt, revokedAt: null };
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

export function createLiveIntegrationsClient(): IntegrationsClient {
  return {
    async load() {
      const [keys, billing] = await Promise.all([
        browserJson<unknown>("/api/me/api-keys"),
        browserJson<unknown>("/api/me/billing"),
      ]);
      if (!keys.ok) return keys;
      if (!billing.ok) return billing;
      const parsedKeys = parseApiKeys(keys.data);
      const parsedCard = parseBillingCard(billing.data);
      if (!parsedKeys || !parsedCard) return unexpected();
      return { ok: true, status: 200, data: { keys: parsedKeys, card: parsedCard.card } };
    },
    async createKey(input) {
      const result = await browserJson<unknown>("/api/me/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: input.name, mode: input.mode }),
      });
      if (!result.ok) return result;
      const created = parseCreatedKey(result.data);
      if (!created) return unexpected();
      return { ok: true, status: result.status, data: created };
    },
    async revokeKey(id) {
      const result = await browserJson<unknown>(`/api/me/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!result.ok) return result;
      if (!result.data || typeof result.data !== "object") return unexpected();
      const row = result.data as { id?: unknown; revokedAt?: unknown };
      const revokedId = text(row.id);
      if (!revokedId) return unexpected();
      return { ok: true, status: result.status, data: { id: revokedId, revokedAt: text(row.revokedAt) } };
    },
    async saveWebhook(url) {
      const result = await browserJson<unknown>("/api/me/webhook", {
        method: "PUT",
        body: JSON.stringify({ url }),
      });
      if (!result.ok) return result;
      const saved = parseSavedWebhook(result.data);
      if (!saved) return unexpected();
      return { ok: true, status: result.status, data: saved };
    },
    async createSetupIntent() {
      const result = await browserJson<unknown>("/api/me/billing/setup-intent", { method: "POST" });
      if (!result.ok) return result;
      const secret = parseSetupIntent(result.data);
      if (!secret) return unexpected();
      return { ok: true, status: result.status, data: secret };
    },
    async loadCard() {
      const result = await browserJson<unknown>("/api/me/billing");
      if (!result.ok) return result;
      const parsed = parseBillingCard(result.data);
      if (!parsed) return unexpected();
      return { ok: true, status: result.status, data: parsed.card };
    },
    async removeCard() {
      const result = await browserJson<unknown>("/api/me/billing", { method: "DELETE" });
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
