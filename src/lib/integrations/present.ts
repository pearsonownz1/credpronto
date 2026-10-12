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

export function quickStartCurl(secret: string | null): string {
  const key = secret && secret.trim() !== "" ? secret.replace(/\\/g, "\\\\").replace(/"/g, '\\"') : "<key>";
  return [
    "curl https://www.credpronto.com/api/v1/orders \\",
    `  -H "Authorization: Bearer ${key}" \\`,
    "  -F file=@acta.pdf \\",
    "  -F service=translation \\",
    "  -F source_language=es",
    "",
    "# Verify the CredPronto-Signature header on each webhook.",
    "# It is t=<unix seconds>,v1=<hex HMAC-SHA256 of ${t}.${rawBody}>.",
  ].join("\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
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
