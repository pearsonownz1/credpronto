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

/** First eight characters shown on account order rows. Links keep the full id. */
export function shortOrderId(orderId: string): string {
  return orderId.trim().slice(0, 8);
}

/**
 * Price on an account order row, from fields the order list already returns.
 * Prefer the order total. Otherwise the unit price times pages, then the unit price.
 */
export function orderPricePaid(order: {
  totalCents: number | null;
  unitPriceCents?: number | null;
  billablePages?: number | null;
}): string {
  if (order.totalCents != null) return formatOrderMoney(order.totalCents);
  const unit = order.unitPriceCents;
  const pages = order.billablePages;
  if (unit != null && pages != null && pages > 0) return formatOrderMoney(unit * pages);
  if (unit != null) return formatOrderMoney(unit);
  return "—";
}

function minutesUntil(etaAt: string | null | undefined, now: number): number | null {
  if (!etaAt) return null;
  const target = Date.parse(etaAt);
  if (!Number.isFinite(target)) return null;
  const minutes = Math.round((target - now) / 60_000);
  return minutes >= 1 ? minutes : null;
}

function firstLanguage(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function displayLanguage(value: string): string {
  const label = languageLabel(value);
  if (label !== "Unknown") return label;
  const trimmed = value.trim();
  if (/^[a-z]{2,8}(-[a-z0-9]+)*$/i.test(trimmed)) return label;
  return trimmed;
}

/** Order code, then order name, then the same fields on a document. */
function sourceLanguageOf(order: CustomerOrder): string | null {
  const direct = firstLanguage(order.sourceLanguage, order.sourceLanguageName);
  if (direct) return direct;
  for (const document of order.documents ?? []) {
    const value = firstLanguage(document.sourceLanguage, document.sourceLanguageName, document.detectedLanguage);
    if (value) return value;
  }
  return null;
}

function targetLanguageOf(order: CustomerOrder): string | null {
  const direct = firstLanguage(order.targetLanguage, order.targetLanguageName);
  if (direct) return direct;
  for (const document of order.documents ?? []) {
    const value = firstLanguage(document.targetLanguage, document.targetLanguageName);
    if (value) return value;
  }
  return null;
}

function languagePair(order: CustomerOrder): string {
  const source = sourceLanguageOf(order);
  if (!source) return "—";
  const target = targetLanguageOf(order) ?? "en";
  return `${displayLanguage(source)} → ${displayLanguage(target)}`;
}

function standaloneEvaluation(order: {
  serviceType?: string | null;
  includeTranslation?: boolean | null;
}): boolean {
  return order.serviceType === "evaluation" && order.includeTranslation !== true;
}

function evaluationStillRunning(order: {
  status: string;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
}): boolean {
  return (
    standaloneEvaluation(order) &&
    order.status !== "preview_ready" &&
    order.status !== "paid" &&
    order.status !== "approved" &&
    order.status !== "delivered" &&
    order.status !== "cancelled"
  );
}

/** Where a dashboard row opens. Prefer the email token; otherwise the order id the list already returns. */
export function orderStepHref(order: {
  status: string;
  id?: string | null;
  orderToken?: string | null;
  serviceType?: string | null;
  includeTranslation?: boolean | null;
}): string | null {
  const token = order.orderToken?.trim() || null;
  const orderId = order.id?.trim() || null;
  const key = token || (orderId && isOrderId(orderId) ? orderId : null);
  if (!key) return null;
  const id = encodeURIComponent(key);
  if (evaluationStillRunning(order)) {
    return `/order/${id}`;
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
    total: orderPricePaid(order),
  };

  if (order.paymentStatus === "refunded") {
    return { ...base, tab: "refunded", chip: { label: "Refunded", tone: "neutral" }, action: NONE };
  }

  if (evaluationStillRunning(order)) {
    return {
      ...base,
      tab: "translating",
      chip: { label: "Evaluating", tone: "neutral" },
      action: NONE,
    };
  }

  switch (order.status) {
    case "draft":
    case "needs_review":
      return { ...base, tab: "translating", chip: { label: "Uploaded", tone: "neutral" }, action: NONE };
    case "confirmed":
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
      return {
        ...base,
        tab: "preview_ready",
        chip: { label: "Preview ready", tone: "blue" },
        action: {
          kind: "review",
          label: standaloneEvaluation(order) ? "Review" : "Buy now",
          emphasis: "primary",
          href: rowHref,
        },
      };
    case "paid":
    case "approved":
      if (order.serviceType === "evaluation" && order.includeTranslation !== true) {
        return {
          ...base,
          tab: "staff_review",
          chip: { label: "In review", tone: "violet" },
          action: { kind: "waiting", label: "In review", emphasis: "muted", href: null },
        };
      }
      if (order.includeTranslation === true && order.translationReady) {
        return {
          ...base,
          tab: "staff_review",
          chip: { label: "Paid", tone: "ok" },
          action: { kind: "download", label: "Download", emphasis: "link", href: rowHref },
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

/** Settled orders, including a translation bundled with an evaluation. */
export function receiptOrders(orders: readonly CustomerOrder[]): CustomerOrder[] {
  return orders.filter((order) => {
    if (order.paymentStatus === "refunded") return false;
    if (order.paymentStatus === "paid" || order.paymentStatus === "paid_test") return true;
    return order.status === "paid" || order.status === "approved" || order.status === "delivered";
  });
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
