import { DASHBOARD_TABS, presentOrder, type DashboardTab } from "@/lib/account/present";
import type { CustomerOrder } from "@/lib/api/types";

const TAB_IDS = new Set<string>(DASHBOARD_TABS.map((tab) => tab.id));

export type StageInput = {
  id?: string;
  status: string;
  serviceType: string;
  paymentStatus?: string | null;
  etaAt?: string | null;
  includeTranslation?: boolean | null;
  downloadAvailable?: boolean;
  translationReady?: boolean;
  totalCents?: number | null;
  billablePages?: number | null;
};

export function customerStage(order: StageInput, now = Date.now()) {
  const view = presentOrder(asCustomerOrder(order), now);
  const tab = DASHBOARD_TABS.find((item) => item.id === view.tab);
  return {
    stage: view.tab,
    stageLabel: tab?.label ?? view.chip.label,
    label: view.chip.label,
    etaAt: order.etaAt ?? null,
  };
}

export function matchesStatusFilter(order: StageInput, filter: string | null, now = Date.now()): boolean {
  if (!filter) return true;
  if (order.status === filter) return true;
  if (!TAB_IDS.has(filter)) return false;
  return customerStage(order, now).stage === (filter as DashboardTab);
}

function asCustomerOrder(order: StageInput): CustomerOrder {
  return {
    id: order.id ?? "order",
    status: order.status,
    serviceType: order.serviceType,
    totalCents: order.totalCents ?? null,
    currency: "usd",
    billablePages: order.billablePages ?? null,
    unitPriceCents: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    previewAvailable: order.status === "preview_ready",
    paymentStatus: order.paymentStatus ?? null,
    downloadAvailable: order.downloadAvailable === true,
    etaAt: order.etaAt,
    includeTranslation: order.includeTranslation === true,
    translationReady: order.translationReady === true,
  };
}
