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
  /** Not on GET /api/me/orders. Present only when a caller adds display context. */
  documentsLabel?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  orderToken?: string | null;
  etaAt?: string | null;
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

export type StaffFinalVersion = {
  version: number;
  path: string;
  uploadedBy: string;
  uploadedAt: string;
  current: boolean;
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
  filename: string;
  pages: StaffPage[];
  corrections: StaffCorrection[];
  payment: { status: string; paidAt: string | null } | null;
  delivery: { status: string; approvedAt: string | null; deliveredAt: string | null } | null;
  originalUrl: string | null;
  translationUrl: string | null;
  /** Absent until the order payload includes a QA report. */
  qa: QaReport | null;
  expedited: boolean;
  finalVersions: StaffFinalVersion[];
  fulfillment: {
    mail: {
      status: "pending" | "shipped";
      trackingNumber: string | null;
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
    notarization: { status: "pending" | "done" } | null;
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
