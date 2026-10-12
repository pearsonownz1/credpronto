import { HttpError } from "./errors";
import type { AddonId, ShippingAddress } from "./types";

/** Historical Expedited rows used a flat unit. New orders do not offer the add-on. */
export const EXPEDITED_UNIT = "order" as const;

export const ADDON_CATALOG = [
  { id: "notarization", label: "Notarization", unitCents: 1795, per: "order" },
  { id: "mail", label: "USPS Priority hard copy", unitCents: 1295, per: "order" },
  { id: "expedited", label: "Expedited", unitCents: 995, per: EXPEDITED_UNIT },
] as const;

const ADDON_IDS = new Set<string>(ADDON_CATALOG.map((item) => item.id));

export type AddonOrderContext = {
  serviceType?: string | null;
  orderType?: string | null;
  service?: string | null;
};

/** Expedited is not offered on translation or evaluation orders. */
export function offersExpedited(order: AddonOrderContext): boolean {
  void order;
  return false;
}

function offeredCatalog(order: AddonOrderContext) {
  if (offersExpedited(order)) return ADDON_CATALOG;
  return ADDON_CATALOG.filter((item) => item.id !== "expedited");
}

/** Words for an add-on unit. The phrase comes from the quote's `per` field. */
export function addonUnitPhrase(per: "order" | "page"): "per order" | "per page" {
  return per === "page" ? "per page" : "per order";
}

export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

const US_STATES = new Set<string>(US_STATE_CODES);

export type AddonOption = {
  id: AddonId;
  label: string;
  unitCents: number;
  per: "order" | "page";
  totalCents: number | null;
};

export type PricedAddon = {
  id: AddonId;
  label: string;
  unitCents: number;
  per: "order" | "page";
  quantity: number;
  totalCents: number;
};

export type CheckoutSelection = {
  addons: PricedAddon[];
  shippingAddress: ShippingAddress | null;
  addonCents: number;
};

export function addonOptions(billablePages: number | null, order: AddonOrderContext = {}): AddonOption[] {
  const pages = billablePages != null && billablePages > 0 ? billablePages : null;
  return offeredCatalog(order).map((item) => ({
    id: item.id,
    label: item.label,
    unitCents: item.unitCents,
    per: item.per,
    totalCents: item.per === "order" ? item.unitCents : pages == null ? null : item.unitCents * pages,
  }));
}

export function selectedAddonIds(addons: unknown, order: AddonOrderContext = {}): AddonId[] {
  if (!Array.isArray(addons)) throw new HttpError("Unknown add-on", 400);
  const seen = new Set<string>();
  const chosen: AddonId[] = [];
  for (const entry of addons) {
    if (entry === "expedited" && !offersExpedited(order)) {
      throw new HttpError("Expedited is no longer offered", 400);
    }
    if (typeof entry !== "string" || !ADDON_IDS.has(entry) || seen.has(entry)) {
      throw new HttpError("Unknown add-on", 400);
    }
    seen.add(entry);
    chosen.push(entry as AddonId);
  }
  return chosen;
}

/** New orders store false. A request that still sends Expedited is rejected. */
export function expeditedFlagForAddons(order: AddonOrderContext, addons: readonly { id: string }[]): boolean {
  const chosen = addons.some((item) => item.id === "expedited");
  if (chosen && !offersExpedited(order)) throw new HttpError("Expedited is no longer offered", 400);
  return chosen;
}

/** Add-ons a customer can buy. Expedited is omitted for every order type. */
export function offeredAddonOptions(
  billablePages: number | null,
  orderType: string | null | undefined,
): AddonOption[] {
  return withoutExpedited(addonOptions(billablePages, { orderType }), true);
}

export function withoutExpedited<T extends { id: string }>(options: readonly T[], hide: boolean): T[] {
  if (!hide) return [...options];
  return options.filter((item) => item.id !== "expedited");
}

export function serviceCents(order: {
  billablePages: number | null;
  unitPriceCents: number;
  service: string | null;
  evaluationCents: number | null;
  translationCents: number | null;
}): number | null {
  if (order.service && order.evaluationCents != null && order.translationCents != null) {
    return order.evaluationCents + order.translationCents;
  }
  if (order.billablePages != null && order.billablePages > 0) {
    return order.billablePages * order.unitPriceCents;
  }
  return null;
}

export function parseCheckoutBody(
  body: unknown,
  billablePages: number | null,
  order: AddonOrderContext = {},
): CheckoutSelection {
  const record =
    body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (record.addons == null) {
    return { addons: [], shippingAddress: null, addonCents: 0 };
  }
  const chosen = selectedAddonIds(record.addons, order);
  const seen = new Set<string>(chosen);
  // Add-ons are flat per order. The page count stays on the signature for callers.
  void billablePages;

  const shippingAddress = seen.has("mail") ? parseShippingAddress(record.shippingAddress) : null;
  const addons = ADDON_CATALOG.filter((item) => seen.has(item.id)).map((item) => {
    const quantity = 1;
    return {
      id: item.id,
      label: item.label,
      unitCents: item.unitCents,
      per: item.per,
      quantity,
      totalCents: item.unitCents * quantity,
    };
  });
  return {
    addons,
    shippingAddress,
    addonCents: addons.reduce((sum, item) => sum + item.totalCents, 0),
  };
}

export function chargeCents(
  service: number | null,
  options: AddonOption[],
  selected: readonly string[],
): number | null {
  if (service == null) return null;
  let extra = 0;
  for (const id of selected) {
    const option = options.find((item) => item.id === id);
    if (!option || option.totalCents == null) return null;
    extra += option.totalCents;
  }
  return service + extra;
}

export function addonStripeLines(addons: PricedAddon[]): Array<{
  name: string;
  quantity: number;
  unitAmountCents: number;
}> {
  return addons.map((item) => ({
    name: item.label,
    quantity: item.quantity,
    unitAmountCents: item.unitCents,
  }));
}

function parseShippingAddress(value: unknown): ShippingAddress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError("Mail requires a US shipping address", 400);
  }
  const row = value as Record<string, unknown>;
  const name = bounded(row.name, 120);
  const line1 = bounded(row.line1, 200);
  const line2 = row.line2 == null || row.line2 === "" ? null : bounded(row.line2, 200);
  const city = bounded(row.city, 120);
  const state = typeof row.state === "string" ? row.state.trim().toUpperCase() : "";
  const postalCode = typeof row.postalCode === "string" ? row.postalCode.trim() : "";
  const country = typeof row.country === "string" ? row.country.trim().toUpperCase() : "";
  if (
    !name ||
    !line1 ||
    line2 === "" ||
    !city ||
    !US_STATES.has(state) ||
    !/^\d{5}(-\d{4})?$/.test(postalCode) ||
    country !== "US"
  ) {
    throw new HttpError("Mail requires a US shipping address", 400);
  }
  return { name, line1, line2, city, state, postalCode, country: "US" };
}

function bounded(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) return "";
  return trimmed;
}
