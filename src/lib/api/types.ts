import type { PageKind, RenderBlock } from "@/lib/orders/pdf/layout";

export type CustomerOrderDocument = {
  detectedLanguage?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  sourceLanguageName?: string | null;
  targetLanguageName?: string | null;
};

export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiFail = { ok: false; status: number; error: string };
export type ApiResult<T> = ApiOk<T> | ApiFail;

export type CustomerOrder = {
  id: string;
  status: string;
  serviceType: string;
  totalCents: number | null;
  currency: string;
  billablePages: number | null;
  unitPriceCents: number;
  createdAt: string;
  previewAvailable: boolean;
  paymentStatus: string | null;
  downloadAvailable: boolean;
  /** File names for this order. Present on GET /api/me/orders. */
  documentName?: string | null;
  /** Not on GET /api/me/orders. Present only when a caller adds display context. */
  documentsLabel?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  /** Display name when the payload sends a name instead of a language code. */
  sourceLanguageName?: string | null;
  targetLanguageName?: string | null;
  /** Languages on the order's files, when the list includes them. */
  documents?: CustomerOrderDocument[] | null;
  orderToken?: string | null;
  etaAt?: string | null;
  /** True when this evaluation also includes a certified translation. */
  includeTranslation?: boolean;
  /** Paid bundle with a stored certified translation. The evaluation may still be in review. */
  translationReady?: boolean;
};

export type AdminOrder = {
  id: string;
  status: string;
  serviceType: string;
  sourceLanguage: string | null;
  billablePages: number | null;
  totalCents: number | null;
  currency: string;
  createdAt: string;
  reviewReason: string | null;
  email: string | null;
  expedited: boolean;
  paidAt: string | null;
  fulfillment: "released" | "awaiting_review" | null;
};

export type AdminList = {
  orders: AdminOrder[];
  page: { limit: number; offset: number; total: number };
};

export type StaffPage = {
  id: string;
  documentId: string;
  pageNumber: number;
  sourceText: string | null;
  paragraphs: string[];
  /** Source line index for each paragraph, when the translation stores or derives one. */
  sourceIndexes?: number[];
  /** Position in the combined original, starting at 1. */
  combinedPageNumber: number;
  widthPt: number;
  heightPt: number;
  /** Stored page layout. Null when the translation has no certificate or letter kind. */
  kind: PageKind | null;
  /** Structured blocks for the table editor. Empty when the page has no translation yet. */
  blocks: RenderBlock[];
};

export type StaffCorrection = {
  id: string;
  pageNumber: number | null;
  note: string | null;
  passage: string | null;
  status: string;
  createdAt: string;
};

export type StaffNote = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export type QaStatus = "pass" | "fail" | "retranslated";

export type QaIssueType = "name" | "date" | "number" | "missing_text" | "layout" | "other";

export type QaIssue = {
  type: QaIssueType;
  severity: string;
  page: number | null;
  original: string;
  translated: string;
  note: string;
};

export type QaReport = {
  status: QaStatus;
  score: number;
  checkedAt: string | null;
  attempts: number;
  issues: QaIssue[];
};

export type StaffDetail = {
  id: string;
  status: string;
  email: string | null;
  sourceLanguage: string | null;
  targetLanguage: string;
  billablePages: number | null;
  totalCents: number | null;
  currency: string;
  createdAt: string;
  reviewReason: string | null;
  /** Set for credential evaluations. Translation orders leave this null. */
  service: "diploma" | "course_by_course" | null;
  /** Selected services from resolveServices, in catalog order. */
  services: Array<"translation" | "diploma" | "course_by_course">;
  /** True when the resolved services include certified translation. */
  includesTranslation: boolean;
  /** One entry for each purchased evaluation report. */
  evaluationReports: Array<{
    service: "diploma" | "course_by_course";
    uploaded: boolean;
    fileName?: string;
    /** Short-lived staff link for a stored evaluation PDF. */
    url?: string;
  }>;
  /** Structured text for each stored evaluation. Absent until the order payload includes it. */
  evaluations?: Array<{
    service: "diploma" | "course_by_course";
    heading: string;
    lines: string[];
  }>;
  /** Reasons from the last paid evaluation run. Empty once that service is stored. */
  evaluationFailures?: Array<{
    service: "diploma" | "course_by_course";
    reason: string;
  }>;
  equivalencyCredentials: Array<{
    credential: string;
    country: string;
    field: string;
    dates: string;
    usEquivalency: string;
    basis: string | null;
  }>;
  edge: {
    title: string;
    levelNumber: number | null;
    levelTitle: string | null;
    contentExcerpt: string;
    url: string | null;
    gradingScale: {
      title: string;
      rows: Array<{ indigenousGrade: string; usEquivalent: string }>;
    } | null;
  } | null;
  filename: string;
  pages: StaffPage[];
  originals: Array<{ filename: string; url: string | null; pages: number | null }>;
  corrections: StaffCorrection[];
  payment: { status: string; paidAt: string | null } | null;
  delivery: { status: string; approvedAt: string | null; deliveredAt: string | null } | null;
  originalUrl: string | null;
  translationUrl: string | null;
  /** Absent until the order payload includes a QA report. */
  qa: QaReport | null;
  expedited: boolean;
  /** Staff evaluation stage. Null until payment or a staff update sets one. */
  evaluationStatus: "under_review" | "performing_evaluation" | "performing_layout" | "evaluation_complete" | null;
  evaluationStatusAt: {
    under_review: string | null;
    performing_evaluation: string | null;
    performing_layout: string | null;
    evaluation_complete: string | null;
  };
  fulfillment: {
    mail: {
      status: "pending" | "shipped";
      trackingNumber: string | null;
      carrier: string | null;
      shippedAt: string | null;
      address: {
        name: string;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        postalCode: string;
        country: "US";
      } | null;
    } | null;
    notarization: { status: "pending" | "notarized" | "done" } | null;
  };
};

export function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  if (status === 401) return "Sign in required";
  if (status === 403) return "Staff access required";
  return "Request failed";
}
