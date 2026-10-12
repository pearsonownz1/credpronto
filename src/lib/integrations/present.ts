export function formatKeyCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
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
