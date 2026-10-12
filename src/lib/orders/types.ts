import type { OrderProgress } from "./reading-progress";

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
  | "expired"
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
  | "downloaded"
  | "account_linked"
  | "translation_edited"
  | "note_added"
  | "approved"
  | "staff_notified";

export type PageOrderBasis = "logical" | "upload";

export type StoredPage = {
  documentId: string;
  uploadPosition: number;
  appliedPosition: number;
  uploadPage: number;
  appliedPage: number;
  logicalPage: number | null;
  hint: string | null;
  confidence: number | null;
};

export type StoredPageOrder = {
  basis: PageOrderBasis;
  pages: StoredPage[];
};

export type OrderType = "translation" | "evaluation" | "expert_letter";

export type EvaluationService = "diploma" | "course_by_course";

export type EvaluationLine = {
  kind: "evaluation" | "translation";
  description: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
};

export type DiplomaCredential = {
  applicant: string;
  institution: string;
  country: string;
  credential: string;
  field: string;
  dates: string;
  usEquivalency: string;
  documentsReviewed: string[];
};

export type CourseRow = {
  originalName: string;
  englishName: string;
  localCredits: number;
  localGrade: string;
  usSemesterHours: number;
  usGrade: string;
  gradePoints: number;
};

export type EvaluationResult =
  | { kind: "diploma"; credentials: DiplomaCredential[]; pageCount?: number }
  | {
      kind: "course_by_course";
      applicant: string;
      institution: string;
      country: string;
      credential: string;
      years: Array<{ year: string; courses: CourseRow[] }>;
      totalHours: number;
      gpa: number;
      gradeScale: string;
      usEquivalency?: string;
      pageCount?: number;
    };

export type AddonId = "notarization" | "mail" | "expedited";

export type ShippingAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: "US";
};

export type OrderRecord = {
  id: string;
  customerId: string;
  userId: string | null;
  serviceType: string;
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
  pageOrderBasis: PageOrderBasis | null;
  pageOrder: StoredPageOrder | null;
  externalRef: string | null;
  orderType: OrderType;
  service: EvaluationService | null;
  degreeCount: number | null;
  evaluationCents: number | null;
  translationCents: number | null;
  /** True when the customer chose certified translation on an evaluation. */
  includeTranslation: boolean;
  evaluationResult: EvaluationResult | null;
  addonCents: number;
  expedited: boolean;
  shippingAddress: ShippingAddress | null;
  mailStatus: "pending" | "shipped" | null;
  mailTracking: string | null;
  notarizationStatus: "pending" | "done" | null;
  edgeCredentialId: string | null;
  edgeGradingScaleId: string | null;
  createdAt: string;
  updatedAt: string;
  progress: OrderProgress;
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
  appliedPosition: number | null;
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
  uploadPage: number | null;
  logicalPage: number | null;
  orderHint: string | null;
  qualityScore: number | null;
  qualityFlags: string[];
  qualityMessage: string | null;
  /** Present when the quote can skip this side. Omitted until that column exists. */
  skip?: boolean;
  skipReason?: string | null;
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
  createdAt: string;
};

export type TranslationRecord = {
  id: string;
  documentId: string;
  version: number;
  model: string | null;
  status: string;
  output: unknown;
};

export type OrderNoteRecord = {
  id: string;
  orderId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export type DeliveryRecord = {
  id: string;
  orderId: string;
  status: DeliveryStatus;
  finalPath: string | null;
  certificationPath: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
};
