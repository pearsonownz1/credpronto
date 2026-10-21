import { downloadGate } from "./access";
import { bundleTranslationReady, type BundleTranslationInput } from "./final-file";

export type CustomerPayment = {
  status: string;
  createdAt: string;
};

/** Settled payment wins. Otherwise the newest row, including refunded. */
export function paymentStatusForCustomer(payments: CustomerPayment[]): string | null {
  const settled = payments.find((payment) => payment.status === "paid" || payment.status === "paid_test");
  if (settled) return settled.status;
  const sorted = [...payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted[0]?.status ?? null;
}

export function summarizeCustomerOrder(input: {
  id: string;
  status: string;
  serviceType: string;
  totalCents: number | null;
  currency: string;
  billablePages: number | null;
  unitPriceCents: number;
  createdAt: string;
  previewReady: boolean;
  paymentStatus: string | null;
  deliveryStatus: string | null;
  includeTranslation?: boolean;
  finalTranslationPath?: string | null;
  certificationPath?: string | null;
  reviewReason?: string | null;
  qa?: BundleTranslationInput["qa"];
  languageConfidence?: number | null;
  pageNeedsReview?: boolean;
  openCorrections?: boolean;
  deliveryFinalPath?: string | null;
  autoReleaseEnabled?: boolean;
}) {
  const gate = downloadGate({
    paymentStatus: input.paymentStatus,
    deliveryStatus: input.deliveryStatus,
  });
  return {
    id: input.id,
    status: input.status,
    serviceType: input.serviceType,
    totalCents: input.totalCents,
    currency: input.currency,
    billablePages: input.billablePages,
    unitPriceCents: input.unitPriceCents,
    createdAt: input.createdAt,
    previewAvailable: input.previewReady,
    paymentStatus: input.paymentStatus,
    downloadAvailable: gate.ok,
    includeTranslation: input.includeTranslation === true,
    translationReady: bundleTranslationReady({
      includeTranslation: input.includeTranslation,
      status: input.status,
      paymentStatus: input.paymentStatus,
      finalTranslationPath: input.finalTranslationPath,
      certificationPath: input.certificationPath,
      reviewReason: input.reviewReason,
      qa: input.qa,
      languageConfidence: input.languageConfidence,
      pageNeedsReview: input.pageNeedsReview,
      openCorrections: input.openCorrections,
      deliveryStatus: input.deliveryStatus,
      deliveryFinalPath: input.deliveryFinalPath,
      enabled: input.autoReleaseEnabled,
    }),
  };
}
