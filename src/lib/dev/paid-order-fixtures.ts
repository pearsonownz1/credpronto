import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import type { CustomerOrder } from "@/lib/orders/view";

type ReviewFixture = {
  id: string;
  email: string | null;
  totalCents: number | null;
  paidAt: string | null;
};

function paidOrder(patch: Partial<CustomerOrder>): CustomerOrder {
  return {
    ...sampleCustomerOrder(),
    status: "paid",
    payment: { status: "paid" },
    delivery: { status: "pending" },
    fulfillment: "awaiting_review",
    email: "ada@example.com",
    service: null,
    includeTranslation: false,
    translationReady: false,
    evaluation: null,
    evaluationStatus: null,
    ...patch,
  };
}

/** Translation still in the first paid review. `services` is the list, not the old service field. */
export function translationInReviewOrder(fixture?: ReviewFixture): CustomerOrder {
  return paidOrder({
    orderId: fixture?.id ?? "CP-24802",
    email: fixture?.email ?? "ada@example.com",
    totalCents: fixture?.totalCents ?? 2985,
    paidAt: fixture?.paidAt ?? null,
    services: ["translation"],
    orderType: "translation",
    documentTitle: "Birth certificate",
  });
}

/** Whole translation approved and the delivery email already sent. */
export function translationReadyOrder(): CustomerOrder {
  return paidOrder({
    orderId: "11111111-2222-4333-8444-555555555555",
    status: "delivered",
    delivery: { status: "delivered" },
    fulfillment: "released",
    paidAt: "2026-04-01T00:00:00.000Z",
    deliveredAt: "2026-04-02T00:00:00.000Z",
    totalCents: 1990,
    services: ["translation"],
    orderType: "translation",
    documentTitle: "Birth certificate",
  });
}

/**
 * Translation is done and the evaluation is still open.
 * The service list is the source of truth; `service` stays empty.
 */
export function comboTranslationDoneOrder(): CustomerOrder {
  return paidOrder({
    orderId: "9b80cd30-0000-4000-8000-000000000001",
    paidAt: "2026-04-01T00:00:00.000Z",
    totalCents: 8975,
    services: ["translation", "diploma"],
    orderType: "translation",
    translationReady: true,
    evaluationStatus: "under_review",
    documentTitle: "Diploma",
  });
}

/** Evaluation just paid. The list says diploma even when `service` is empty. */
export function evaluationInReviewOrder(): CustomerOrder {
  return paidOrder({
    orderId: "22222222-3333-4444-8555-666666666666",
    paidAt: "2026-04-01T00:00:00.000Z",
    totalCents: 1995,
    services: ["diploma"],
    orderType: "translation",
    evaluationStatus: "under_review",
    documentTitle: "Diploma",
  });
}
