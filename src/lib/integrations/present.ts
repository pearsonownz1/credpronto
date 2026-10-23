import { SITE_ORIGIN } from "@/lib/seo";
import type { ApiOrder } from "./client";

export function formatKeyCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export function formatPlaced(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** `cp_live_ab12…` from the stored prefix and the key's last 4 characters. */
export function formatKeyPrefix(prefix: string, last4: string): string {
  if (!prefix && !last4) return "";
  return `${prefix}${last4}…`;
}

export function formatLastUsed(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const delta = now - then;
  if (delta < 60_000) return "Just now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
  const hours = Math.round(delta / 3_600_000);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(delta / 86_400_000);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatKeyCreated(iso);
}

export function maskKey(prefix: string, last4: string): string {
  return `${prefix}…${last4}`;
}

export function maskWebhookSecret(last4: string): string {
  return `whsec_${"•".repeat(16)}${last4}`;
}

export function formatCardExpiry(month: number, year: number): string {
  const mm = String(month).padStart(2, "0");
  const yy = String(year).slice(-2).padStart(2, "0");
  return `Expires ${mm}/${yy}`;
}

export function formatCardLabel(brand: string, last4: string): string {
  return `${brand} •••• ${last4}`;
}

/** Charged amount from the API. A missing amount stays blank — never a stand-in price. */
export function formatCharged(cents: number | null, currency: string): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "";
  if (!code) return (cents / 100).toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

export function formatDeliveryStatus(delivery: { status: string; event: string; at: string } | null): string {
  if (!delivery) return "No deliveries yet";
  const status = delivery.status.charAt(0).toUpperCase() + delivery.status.slice(1);
  const when = formatPlaced(delivery.at);
  return when ? `${status} · ${delivery.event} · ${when}` : `${status} · ${delivery.event}`;
}

export function safeOrderLink(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

/** Scrolls inside the card and wraps long lines on a narrow screen. */
export const QUICK_START_CODE_CLASS =
  "block w-full min-w-0 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--cp-radius)] bg-[#0b1220] p-4 font-mono text-[11.5px] leading-[1.6] text-[#d6e0ff]";

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Bearer token for a sample. A real secret is escaped for double quotes. */
export function sampleBearer(secret: string | null): string {
  if (!secret || secret.trim() === "") return "<key>";
  return secret.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * `POST /api/v1/orders` as the handler reads it.
 * `files` is the upload field. `service` and `source_language` are required for a translation.
 * `target_language` defaults to `en`. `external_ref` is optional and idempotent.
 */
export function orderCreateCurl(secret: string | null): string {
  const key = sampleBearer(secret);
  return [
    `curl -X POST ${SITE_ORIGIN}/api/v1/orders \\`,
    `  -H "Authorization: Bearer ${key}" \\`,
    "  -F files=@acta.pdf \\",
    "  -F service=translation \\",
    "  -F source_language=es \\",
    "  -F target_language=en \\",
    "  -F external_ref=crm-1842",
  ].join("\n");
}

/** `201` body from `POST /api/v1/orders`. No `reviewReason` or `qa` on create. */
export function orderCreateResponse(): string {
  return pretty({
    id: "…",
    status: "paid",
    service: "translation",
    sourceLanguage: "es",
    targetLanguage: "en",
    externalRef: "crm-1842",
    billablePages: 3,
    unitPriceCents: 995,
    expeditedUnit: "order",
    totalCents: 2985,
    currency: "usd",
    payment: { status: "paid" },
    progress: { step: "done", pagesRead: 3, pagesTotal: 3 },
    paidAt: "2026-10-12T00:00:00.000Z",
    fulfillment: "awaiting_review",
    delayed: false,
  });
}

export function orderGetCurl(secret: string | null): string {
  const key = sampleBearer(secret);
  return [`curl ${SITE_ORIGIN}/api/v1/orders/{id} \\`, `  -H "Authorization: Bearer ${key}"`].join("\n");
}

/** `GET /api/v1/orders/{id}` adds `reviewReason` and `qa` to the create body. */
export function orderGetResponse(): string {
  return pretty({
    id: "…",
    status: "processing",
    service: "translation",
    sourceLanguage: "es",
    targetLanguage: "en",
    externalRef: "crm-1842",
    billablePages: 3,
    unitPriceCents: 995,
    expeditedUnit: "order",
    totalCents: 2985,
    currency: "usd",
    payment: { status: "paid" },
    progress: {
      step: "translating",
      pagesRead: 3,
      pagesTotal: 3,
      pagesDone: 1,
      pagesTranslateTotal: 3,
    },
    paidAt: "2026-10-12T00:00:00.000Z",
    fulfillment: "awaiting_review",
    delayed: false,
    reviewReason: null,
    qa: null,
  });
}

export function orderFilesCurl(secret: string | null): string {
  const key = sampleBearer(secret);
  return [`curl ${SITE_ORIGIN}/api/v1/orders/{id}/files \\`, `  -H "Authorization: Bearer ${key}"`].join("\n");
}

/** `GET /api/v1/orders/{id}/files` before the translation is released. */
export function orderFilesResponse(): string {
  return pretty({
    downloadAvailable: false,
    originals: [
      {
        documentId: "…",
        filename: "acta.pdf",
        url: "https://…",
        expiresInSeconds: 300,
      },
    ],
    translation: null,
    certification: null,
  });
}

/**
 * Signed-in key routes. `secret` is only on the create response.
 * `GET` returns `prefix` and `last4`, never the raw key.
 */
export function apiKeySamples(): string {
  const created = {
    id: "…",
    name: "Production",
    prefix: "cp_test_",
    last4: "a91f",
    createdAt: "2026-10-12T00:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    secret: "cp_test_…",
  };
  const listed = {
    id: created.id,
    name: created.name,
    prefix: created.prefix,
    last4: created.last4,
    createdAt: created.createdAt,
    lastUsedAt: created.lastUsedAt,
    revokedAt: created.revokedAt,
  };
  return [
    "POST /api/me/api-keys",
    pretty({ name: "Production", mode: "test" }),
    "",
    "201",
    pretty(created),
    "",
    "GET /api/me/api-keys",
    pretty({ keys: [listed] }),
    "",
    "DELETE /api/me/api-keys/{id}",
    pretty({ id: "…", revokedAt: "2026-10-12T01:00:00.000Z" }),
  ].join("\n");
}

export function webhookSignatureNote(): string {
  return [
    "# Verify the CredPronto-Signature header on each webhook.",
    "# It is t=<unix seconds>,v1=<hex HMAC-SHA256 of ${t}.${rawBody}>.",
  ].join("\n");
}

export type ApiSample = { id: string; title: string; code: string };

/** Docs and the Integrations page share these samples. */
export function integrationSamples(secret: string | null): ApiSample[] {
  return [
    {
      id: "sample-keys",
      title: "API keys",
      code: apiKeySamples(),
    },
    {
      id: "sample-create-order",
      title: "Place an order",
      code: orderCreateCurl(secret),
    },
    {
      id: "sample-create-response",
      title: "201 response",
      code: orderCreateResponse(),
    },
    {
      id: "sample-get-order",
      title: "Read an order",
      code: orderGetCurl(secret),
    },
    {
      id: "sample-get-response",
      title: "200 response",
      code: orderGetResponse(),
    },
    {
      id: "sample-files",
      title: "Download files",
      code: orderFilesCurl(secret),
    },
    {
      id: "sample-files-response",
      title: "Files response",
      code: orderFilesResponse(),
    },
    {
      id: "sample-signature",
      title: "Webhook signature",
      code: webhookSignatureNote(),
    },
  ];
}

/** Runnable order call, including the signature check. */
export function quickStartCurl(secret: string | null): string {
  return [orderCreateCurl(secret), "", webhookSignatureNote()].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Practice tools on the integrations page. Coming soon has no connect action. */
export type PartnerAppStatus = "coming_soon";

export type PartnerApp = {
  id: string;
  name: string;
  description: string;
  /** Letter shown in place of a logo. */
  mark: string;
  status: PartnerAppStatus;
};

export const PARTNER_APPS: readonly PartnerApp[] = [
  {
    id: "clio",
    name: "Clio",
    description: "Send evaluation and translation orders from a Clio matter and save finished reports back to it.",
    mark: "C",
    status: "coming_soon",
  },
];

/** Same words the page uses when a section is not available yet. */
export function partnerStatusLabel(status: PartnerAppStatus): "Coming soon" {
  switch (status) {
    case "coming_soon":
      return "Coming soon";
  }
}

export function apiOrdersCsv(orders: ApiOrder[]): string {
  const header = ["order", "customer_reference", "key", "pages", "status", "amount_charged", "currency", "placed_at"];
  const lines = [header.join(",")];
  for (const order of orders) {
    const key = order.keyPrefix && order.keyLast4 ? formatKeyPrefix(order.keyPrefix, order.keyLast4) : (order.keyName ?? "");
    const amount = order.amountCents == null ? "" : (order.amountCents / 100).toFixed(2);
    lines.push(
      [
        order.id,
        order.externalRef ?? "",
        key,
        order.pages == null ? "" : String(order.pages),
        order.status,
        amount,
        order.currency,
        order.placedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
