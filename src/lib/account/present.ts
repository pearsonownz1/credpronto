import { languageLabel } from "@/lib/orders/languages";
import { isOrderId } from "@/lib/orders/token";
import type { CustomerOrder } from "@/lib/api/types";

export const GOOGLE_UNAVAILABLE = "Google sign-in isn't available yet, use email";

export const DASHBOARD_TABS = [
  { id: "all", label: "All" },
  { id: "translating", label: "Translating" },
  { id: "preview_ready", label: "Preview ready" },
  { id: "needs_check", label: "Needs your check" },
  { id: "staff_review", label: "Paid and in staff review" },
  { id: "ready", label: "Ready to download" },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]["id"];
export type ChipTone = "blue" | "warn" | "neutral" | "ok" | "violet";

export type NextAction = {
  kind: "review" | "confirm" | "download" | "waiting" | "none";
  label: string;
  emphasis: "primary" | "link" | "muted";
  href: string | null;
};

export type OrderPresentation = {
  tab: DashboardTab | "refunded" | "cancelled";
  chip: { label: string; tone: ChipTone };
  action: NextAction;
  /** Page for this order's current step. Null when there is no token and no order id. */
  rowHref: string | null;
  pages: number | null;
  documents: string;
  pair: string;
  placed: string;
  total: string;
};

const NONE: NextAction = { kind: "none", label: "—", emphasis: "muted", href: null };

export function messageForGoogleError(error: { message?: string; code?: string } | string): string {
  const text = typeof error === "string" ? error : `${error.code ?? ""} ${error.message ?? ""}`;
  const lower = text.toLowerCase();
  const provider =
    lower.includes("provider") ||
    lower.includes("oauth") ||
    lower.includes("not enabled") ||
    lower.includes("unsupported") ||
    lower.includes("validation_failed");
  if (provider || text.trim() === "") return GOOGLE_UNAVAILABLE;
  return typeof error === "string" ? error : error.message || GOOGLE_UNAVAILABLE;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const raw = parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`;
  return raw.toLocaleUpperCase("en-US");
}

export function serviceLabel(serviceType: string): string {
  if (serviceType === "translation") return "Certified translation";
  if (serviceType === "evaluation") return "Credential evaluation";
  return serviceType;
}

export function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export function formatOrderMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function minutesUntil(etaAt: string | null | undefined, now: number): number | null {
  if (!etaAt) return null;
  const target = Date.parse(etaAt);
  if (!Number.isFinite(target)) return null;
  const minutes = Math.round((target - now) / 60_000);
  return minutes >= 1 ? minutes : null;
}

function languagePair(order: CustomerOrder): string {
  if (!order.sourceLanguage) return "—";
  const target = order.targetLanguage ?? "en";
  return `${languageLabel(order.sourceLanguage)} → ${languageLabel(target)}`;
}

/** Where a dashboard row opens. Prefer the email token; otherwise the order id the list already returns. */
export function orderStepHref(order: {
  status: string;
  id?: string | null;
  orderToken?: string | null;
  serviceType?: string | null;
}): string | null {
  const token = order.orderToken?.trim() || null;
  const orderId = order.id?.trim() || null;
  const key = token || (orderId && isOrderId(orderId) ? orderId : null);
  if (!key) return null;
  const id = encodeURIComponent(key);
  if (order.serviceType === "evaluation" && (order.status === "preview_ready" || order.status === "confirmed")) {
    return `/checkout?token=${id}`;
  }
  if (order.status === "preview_ready") return `/preview/${id}`;
  if (order.status === "quoted") return `/confirm?token=${id}`;
  return `/order/${id}`;
}

export function presentOrder(order: CustomerOrder, now = Date.now()): OrderPresentation {
  const rowHref = orderStepHref(order);
  const base = {
    rowHref,
    pages: order.billablePages,
    documents: order.documentsLabel || serviceLabel(order.serviceType),
    pair: languagePair(order),
    placed: formatOrderDate(order.createdAt),
    total: formatOrderMoney(order.totalCents),
  };

  if (order.paymentStatus === "refunded") {
    return { ...base, tab: "refunded", chip: { label: "Refunded", tone: "neutral" }, action: NONE };
  }

  switch (order.status) {
    case "draft":
    case "needs_review":
      return { ...base, tab: "translating", chip: { label: "Uploaded", tone: "neutral" }, action: NONE };
    case "confirmed":
      if (order.serviceType === "evaluation") {
        return {
          ...base,
          tab: "needs_check",
          chip: { label: "Ready to pay", tone: "warn" },
          action: { kind: "confirm", label: "Pay", emphasis: "primary", href: rowHref },
        };
      }
      return { ...base, tab: "translating", chip: { label: "Translating", tone: "neutral" }, action: NONE };
    case "correction_requested":
    case "failed":
      return { ...base, tab: "translating", chip: { label: "Translating", tone: "neutral" }, action: NONE };
    case "processing": {
      const minutes = minutesUntil(order.etaAt, now);
      return {
        ...base,
        tab: "translating",
        chip: { label: minutes ? `Translating · ~${minutes} min` : "Translating", tone: "neutral" },
        action: NONE,
      };
    }
    case "quoted":
      return {
        ...base,
        tab: "needs_check",
        chip: { label: "Needs your check", tone: "warn" },
        action: {
          kind: "confirm",
          label: "Confirm details",
          emphasis: "link",
          href: rowHref,
        },
      };
    case "preview_ready":
      if (order.serviceType === "evaluation") {
        return {
          ...base,
          tab: "needs_check",
          chip: { label: "Ready to pay", tone: "blue" },
          action: { kind: "review", label: "Pay", emphasis: "primary", href: rowHref },
        };
      }
      return {
        ...base,
        tab: "preview_ready",
        chip: { label: "Preview ready", tone: "blue" },
        action: {
          kind: "review",
          label: "Buy now",
          emphasis: "primary",
          href: rowHref,
        },
      };
    case "paid":
    case "approved":
      if (order.serviceType === "evaluation") {
        return {
          ...base,
          tab: "staff_review",
          chip: { label: "In review", tone: "violet" },
          action: { kind: "waiting", label: "In review", emphasis: "muted", href: null },
        };
      }
      return {
        ...base,
        tab: "staff_review",
        chip: { label: "Paid · being certified", tone: "violet" },
        action: { kind: "waiting", label: "In staff review", emphasis: "muted", href: null },
      };
    case "delivered":
      return {
        ...base,
        tab: "ready",
        chip: { label: "Ready to download", tone: "ok" },
        action: order.downloadAvailable
          ? { kind: "download", label: "Download", emphasis: "link", href: rowHref }
          : NONE,
      };
    case "cancelled":
      return { ...base, tab: "cancelled", chip: { label: "Cancelled", tone: "neutral" }, action: NONE };
    default:
      return { ...base, tab: "translating", chip: { label: "Uploaded", tone: "neutral" }, action: NONE };
  }
}

export function ordersInTab(orders: CustomerOrder[], tab: DashboardTab, now = Date.now()): CustomerOrder[] {
  if (tab === "all") return orders;
  return orders.filter((order) => presentOrder(order, now).tab === tab);
}

export function orderMatches(order: CustomerOrder, query: string, now = Date.now()): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const view = presentOrder(order, now);
  return [order.id, view.documents, view.pair, view.chip.label, view.placed, order.serviceType]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function previewWaiting(orders: CustomerOrder[], now = Date.now()): CustomerOrder[] {
  return orders.filter((order) => presentOrder(order, now).tab === "preview_ready");
}

const INCOMING = new Set([
  "draft",
  "quoted",
  "needs_review",
  "confirmed",
  "processing",
  "preview_ready",
  "correction_requested",
  "failed",
]);

export type AdminBucket = "all" | "incoming" | "active";

export function adminBucket(status: string): AdminBucket | "closed" {
  if (INCOMING.has(status)) return "incoming";
  if (status === "paid" || status === "approved") return "active";
  return "closed";
}

export function inBucket(status: string, bucket: AdminBucket): boolean {
  if (bucket === "all") return true;
  return adminBucket(status) === bucket;
}
