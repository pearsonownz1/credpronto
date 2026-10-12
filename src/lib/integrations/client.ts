import type { ApiResult } from "@/lib/api/types";

/**
 * The only module that loads API keys, the webhook, and the saved card.
 * docs/api.md does not yet specify /api/v1 keys, webhooks, or SetupIntent.
 * Until it does, live methods stay here and do not call unpublished routes.
 * Fixtures run when NEXT_PUBLIC_FLOW_MOCK or NEXT_PUBLIC_CREDPRONTO_MOCK is "1".
 */

export const INTEGRATIONS_UNAVAILABLE = "API keys, saved card, and webhooks are not available yet.";

export const FIXTURE_PRODUCTION_SECRET = "cp_live_7f2Kq9mN4pLx8VwR2cHdYa91f";
export const FIXTURE_WEBHOOK_SECRET = "whsec_9kQm2nLp7vXc4sWd8hRfb21e";
export const FIXTURE_WEBHOOK_URL = "https://api.yourfirm.com/credpronto/hooks";

export const WEBHOOK_EVENTS = [
  "order.preview_ready",
  "order.paid",
  "order.delivered",
  "order.needs_review",
  "order.refunded",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type RevealedKey = {
  id: string;
  name: string;
  secret: string;
};

export type WebhookEndpoint = {
  url: string;
  secretLast4: string;
  lastLabel: string;
  sentCount: number;
  events: WebhookEvent[];
};

export type SavedCard = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type IntegrationsSnapshot = {
  keys: ApiKeyRecord[];
  revealed: RevealedKey | null;
  webhook: WebhookEndpoint;
  card: SavedCard | null;
};

export type IntegrationsClient = {
  current(now: number): IntegrationsSnapshot | null;
  load(now: number): Promise<ApiResult<IntegrationsSnapshot>>;
  createKey(now: number): Promise<ApiResult<IntegrationsSnapshot>>;
  revokeKey(id: string, now: number): Promise<ApiResult<IntegrationsSnapshot>>;
  sendTest(now: number): Promise<ApiResult<IntegrationsSnapshot>>;
  toggleEvent(event: WebhookEvent, now: number): Promise<ApiResult<IntegrationsSnapshot>>;
  revealWebhookSecret(now: number): Promise<ApiResult<{ secret: string }>>;
  replaceCard(now: number): Promise<ApiResult<IntegrationsSnapshot>>;
  removeCard(now: number): Promise<ApiResult<IntegrationsSnapshot>>;
};

const VISA: SavedCard = { brand: "Visa", last4: "4242", expMonth: 8, expYear: 2029 };
const MASTERCARD: SavedCard = { brand: "Mastercard", last4: "4444", expMonth: 12, expYear: 2028 };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function fixtureSnapshot(now: number): IntegrationsSnapshot {
  return {
    keys: [
      {
        id: "key_production",
        name: "Production",
        prefix: "cp_live_",
        last4: "a91f",
        createdAt: "2026-10-11T15:04:00.000Z",
        lastUsedAt: new Date(now - 2 * MINUTE).toISOString(),
      },
      {
        id: "key_staging",
        name: "Staging",
        prefix: "cp_test_",
        last4: "3c07",
        createdAt: "2026-10-09T15:04:00.000Z",
        lastUsedAt: new Date(now - DAY).toISOString(),
      },
    ],
    revealed: {
      id: "key_production",
      name: "Production",
      secret: FIXTURE_PRODUCTION_SECRET,
    },
    webhook: {
      url: FIXTURE_WEBHOOK_URL,
      secretLast4: "b21e",
      lastLabel: "200 OK",
      sentCount: 0,
      events: ["order.preview_ready", "order.paid", "order.delivered", "order.needs_review"],
    },
    card: { ...VISA },
  };
}

function unpublished(): ApiResult<never> {
  return { ok: false, status: 501, error: INTEGRATIONS_UNAVAILABLE };
}

export function createLiveIntegrationsClient(): IntegrationsClient {
  return {
    current() {
      return null;
    },
    async load() {
      return unpublished();
    },
    async createKey() {
      return unpublished();
    },
    async revokeKey() {
      return unpublished();
    },
    async sendTest() {
      return unpublished();
    },
    async toggleEvent() {
      return unpublished();
    },
    async revealWebhookSecret() {
      return unpublished();
    },
    async replaceCard() {
      return unpublished();
    },
    async removeCard() {
      return unpublished();
    },
  };
}

function cloneSnapshot(snapshot: IntegrationsSnapshot): IntegrationsSnapshot {
  return structuredClone(snapshot);
}

export function createMockIntegrationsClient(): IntegrationsClient {
  let store: IntegrationsSnapshot | null = null;
  let seq = 0;

  function ensure(now: number): IntegrationsSnapshot {
    store ??= fixtureSnapshot(now);
    return store;
  }

  function save(next: IntegrationsSnapshot): ApiResult<IntegrationsSnapshot> {
    store = next;
    return { ok: true, status: 200, data: cloneSnapshot(next) };
  }

  return {
    current(now) {
      return cloneSnapshot(ensure(now));
    },
    async load(now) {
      return { ok: true, status: 200, data: cloneSnapshot(ensure(now)) };
    },
    async createKey(now) {
      const current = ensure(now);
      seq += 1;
      const last4 = (0xb000 + seq).toString(16).padStart(4, "0").slice(-4);
      const secret = `cp_live_8cQmN4pLx8VwR2cHdY${last4}`;
      const name = current.keys.some((key) => key.name === "Development") ? `Key ${current.keys.length + 1}` : "Development";
      const created: ApiKeyRecord = {
        id: `key_${seq}`,
        name,
        prefix: "cp_live_",
        last4,
        createdAt: new Date(now).toISOString(),
        lastUsedAt: null,
      };
      return save({
        ...current,
        keys: [...current.keys, created],
        revealed: { id: created.id, name, secret },
      });
    },
    async revokeKey(id, now) {
      const current = ensure(now);
      return save({
        ...current,
        keys: current.keys.filter((key) => key.id !== id),
        revealed: current.revealed?.id === id ? null : current.revealed,
      });
    },
    async sendTest(now) {
      const current = ensure(now);
      return save({
        ...current,
        webhook: {
          ...current.webhook,
          lastLabel: "200 OK",
          sentCount: current.webhook.sentCount + 1,
        },
      });
    },
    async toggleEvent(event, now) {
      const current = ensure(now);
      const selected = new Set(current.webhook.events);
      if (selected.has(event)) selected.delete(event);
      else selected.add(event);
      return save({
        ...current,
        webhook: {
          ...current.webhook,
          events: WEBHOOK_EVENTS.filter((item) => selected.has(item)),
        },
      });
    },
    async revealWebhookSecret() {
      return { ok: true, status: 200, data: { secret: FIXTURE_WEBHOOK_SECRET } };
    },
    async replaceCard(now) {
      const current = ensure(now);
      const card = current.card?.brand === "Visa" ? { ...MASTERCARD } : { ...VISA };
      return save({ ...current, card });
    },
    async removeCard(now) {
      const current = ensure(now);
      return save({ ...current, card: null });
    },
  };
}

export function integrationsUseMock(): boolean {
  return process.env.NEXT_PUBLIC_FLOW_MOCK === "1" || process.env.NEXT_PUBLIC_CREDPRONTO_MOCK === "1";
}

let mockSingleton: IntegrationsClient | null = null;

export function getIntegrationsClient(): IntegrationsClient {
  if (!integrationsUseMock()) return createLiveIntegrationsClient();
  // A fresh client per server render keeps one visitor's clock off the next request.
  if (typeof window === "undefined") return createMockIntegrationsClient();
  mockSingleton ??= createMockIntegrationsClient();
  return mockSingleton;
}
