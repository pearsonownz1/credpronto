export const ORDER_STATUSES = [
  "draft",
  "quoted",
  "confirmed",
  "processing",
  "preview_ready",
  "needs_review",
  "correction_requested",
  "paid",
  "approved",
  "delivered",
  "cancelled",
  "failed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type PaymentStatus =
  | "pending"
  | "paid"
  | "paid_test"
  | "failed"
  | "canceled"
  | "refunded";

export type DeliveryStatus = "pending" | "approved" | "delivered" | "failed";

export type OrderEventType =
  | "landing_view"
  | "upload_started"
  | "upload_done"
  | "quote_shown"
  | "preview_ready"
  | "preview_viewed"
  | "checkout_started"
  | "paid"
  | "refunded"
  | "downloaded";

export type OrderRecord = {
  id: string;
  customerId: string;
  status: OrderStatus;
  sourceLanguage: string | null;
  targetLanguage: string;
  languageConfirmed: boolean;
  billablePages: number | null;
  unitPriceCents: number;
  totalCents: number | null;
  currency: string;
  etaAt: string | null;
  reviewReason: string | null;
  combinedOriginalPath: string | null;
  finalTranslationPath: string | null;
  certificationPath: string | null;
  createdAt: string;
};

export type DocumentRecord = {
  id: string;
  orderId: string;
  originalPath: string;
  filename: string;
  mime: string | null;
  size: number | null;
  pageCount: number | null;
  status: string;
  detectedLanguage: string | null;
  confidence: number | null;
  position: number;
};

export type PageRecord = {
  id: string;
  documentId: string;
  pageNumber: number;
  wordCount: number | null;
  billableUnits: number | null;
  billingBasis: "words" | "cjk" | null;
  ocrText: string | null;
  needsReview: boolean;
  widthPt: number | null;
  heightPt: number | null;
};

export type ConfirmationRecord = {
  id: string;
  documentId: string;
  fieldKey: string;
  originalValue: string | null;
  confirmedValue: string | null;
};

export type CorrectionRecord = {
  id: string;
  documentId: string | null;
  pageNumber: number | null;
  passage: string | null;
  note: string | null;
  status: string;
  resolvedPreviewVersion: number | null;
  createdAt: string;
};

export type PreviewRecord = {
  id: string;
  version: number;
  previewPath: string;
  status: string;
};

export type PaymentRecord = {
  id: string;
  orderId: string;
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number;
  status: PaymentStatus;
  paidAt: string | null;
};

export type DeliveryRecord = {
  id: string;
  status: DeliveryStatus;
  finalPath: string | null;
  certificationPath: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
};
