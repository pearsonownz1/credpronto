import { sourceTextForDisplay } from "@/lib/orders/source-text";
import type {
  AdminList,
  AdminOrder,
  CustomerOrder,
  QaIssue,
  QaIssueType,
  QaReport,
  QaStatus,
  StaffCorrection,
  StaffDetail,
  StaffNote,
  StaffPage,
} from "./types";

const QA_STATUS = new Set<QaStatus>(["pass", "fail", "retranslated"]);
const QA_ISSUE_TYPE = new Set<QaIssueType>(["name", "date", "number", "missing_text", "layout", "other"]);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function amount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function flag(value: unknown): boolean {
  return value === true;
}

export function parseCustomerOrder(value: unknown): CustomerOrder | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const status = text(row.status);
  const createdAt = text(row.createdAt);
  const serviceType = text(row.serviceType);
  if (!id || !status || !createdAt || !serviceType) return null;
  const unit = amount(row.unitPriceCents);
  return {
    id,
    status,
    serviceType,
    totalCents: amount(row.totalCents),
    currency: text(row.currency) ?? "usd",
    billablePages: amount(row.billablePages),
    unitPriceCents: unit ?? 995,
    createdAt,
    previewAvailable: flag(row.previewAvailable),
    paymentStatus: text(row.paymentStatus),
    downloadAvailable: flag(row.downloadAvailable),
    documentsLabel: text(row.documentsLabel),
    sourceLanguage: text(row.sourceLanguage),
    targetLanguage: text(row.targetLanguage),
    orderToken: text(row.orderToken),
    etaAt: text(row.etaAt),
  };
}

export function parseCustomerOrders(body: unknown): CustomerOrder[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { orders?: unknown }).orders)) return null;
  const orders = (body as { orders: unknown[] }).orders.map(parseCustomerOrder);
  if (orders.some((order) => order == null)) return null;
  return orders as CustomerOrder[];
}

export function parseAdminOrder(value: unknown): AdminOrder | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const status = text(row.status);
  const createdAt = text(row.createdAt);
  if (!id || !status || !createdAt) return null;
  return {
    id,
    status,
    serviceType: text(row.serviceType) ?? "translation",
    sourceLanguage: text(row.sourceLanguage),
    billablePages: amount(row.billablePages),
    totalCents: amount(row.totalCents),
    currency: text(row.currency) ?? "usd",
    createdAt,
    reviewReason: text(row.reviewReason),
    email: text(row.email),
    expedited: row.expedited === true,
  };
}

export function parseAdminList(body: unknown): AdminList | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { orders?: unknown }).orders)) return null;
  const orders = (body as { orders: unknown[] }).orders.map(parseAdminOrder);
  if (orders.some((order) => order == null)) return null;
  const page = (body as { page?: unknown }).page;
  const pageRow = page && typeof page === "object" ? (page as Record<string, unknown>) : {};
  const list = orders as AdminOrder[];
  return {
    orders: list,
    page: {
      limit: amount(pageRow.limit) ?? list.length,
      offset: amount(pageRow.offset) ?? 0,
      total: amount(pageRow.total) ?? list.length,
    },
  };
}

function parseQa(value: unknown): QaReport | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = text(row.status);
  const score = amount(row.score);
  const attempts = amount(row.attempts);
  if (!status || !QA_STATUS.has(status as QaStatus) || score == null || attempts == null) return null;
  if (!Array.isArray(row.issues)) return null;
  const issues: QaIssue[] = row.issues.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const issue = entry as Record<string, unknown>;
    const type = text(issue.type);
    const severity = text(issue.severity);
    const page = parseIssuePage(issue.page);
    if (!type || !QA_ISSUE_TYPE.has(type as QaIssueType) || !severity || page === undefined) return [];
    return [
      {
        type: type as QaIssueType,
        severity,
        page,
        original: text(issue.original) ?? "",
        translated: text(issue.translated) ?? "",
        note: text(issue.note) ?? "",
      },
    ];
  });
  return { status: status as QaStatus, score, checkedAt: text(row.checkedAt), attempts, issues };
}

function parseIssuePage(value: unknown): number | null | undefined {
  if (value == null) return null;
  const page = amount(value);
  if (page == null || !Number.isInteger(page) || page < 1) return undefined;
  return page;
}

function paragraphsOf(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const paragraphs = (value as { paragraphs?: unknown }).paragraphs;
  if (!Array.isArray(paragraphs)) return [];
  return paragraphs.filter((item): item is string => typeof item === "string");
}

function equivalencyCredentials(value: unknown): StaffDetail["equivalencyCredentials"] {
  if (!value || typeof value !== "object") return [];
  const result = value as Record<string, unknown>;
  if (result.kind === "course_by_course") {
    const name = text(result.credential);
    const country = text(result.country);
    const usEquivalency = text(result.usEquivalency);
    if (!name || !country || !usEquivalency) return [];
    return [{ credential: name, country, field: "Course-by-course", dates: "—", usEquivalency }];
  }
  if (result.kind !== "diploma" || !Array.isArray(result.credentials)) return [];
  return result.credentials.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const credential = entry as Record<string, unknown>;
    const name = text(credential.credential);
    const country = text(credential.country);
    const field = text(credential.field);
    const dates = text(credential.dates);
    const usEquivalency = text(credential.usEquivalency);
    if (!name || !country || !field || !dates || !usEquivalency) return [];
    return [{ credential: name, country, field, dates, usEquivalency }];
  });
}

export function parseStaffDetail(body: unknown): StaffDetail | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  const id = text(row.id);
  const status = text(row.status);
  const createdAt = text(row.createdAt);
  if (!id || !status || !createdAt) return null;

  const documents = Array.isArray(row.documents) ? row.documents : [];
  const pages: StaffPage[] = [];
  let filename = "Document";
  documents.forEach((document, index) => {
    if (!document || typeof document !== "object") return;
    const doc = document as Record<string, unknown>;
    const documentId = text(doc.id) ?? `document-${index + 1}`;
    if (index === 0 && text(doc.filename)) filename = text(doc.filename) as string;
    const docPages = Array.isArray(doc.pages) ? doc.pages : [];
    for (const page of docPages) {
      if (!page || typeof page !== "object") continue;
      const item = page as Record<string, unknown>;
      const pageNumber = amount(item.pageNumber);
      if (pageNumber == null) continue;
      pages.push({
        id: text(item.id) ?? `${documentId}-${pageNumber}`,
        documentId,
        pageNumber,
        sourceText: sourceTextForDisplay(item.sourceText ?? item.ocrText),
        paragraphs: paragraphsOf(item.translation),
      });
    }
  });

  const corrections: StaffCorrection[] = (Array.isArray(row.corrections) ? row.corrections : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const correction = entry as Record<string, unknown>;
    const correctionId = text(correction.id);
    const created = text(correction.createdAt);
    if (!correctionId || !created) return [];
    return [
      {
        id: correctionId,
        pageNumber: amount(correction.pageNumber),
        note: text(correction.note),
        passage: text(correction.passage),
        status: text(correction.status) ?? "open",
        createdAt: created,
      },
    ];
  });

  const payment = row.payment && typeof row.payment === "object" ? (row.payment as Record<string, unknown>) : null;
  const delivery = row.delivery && typeof row.delivery === "object" ? (row.delivery as Record<string, unknown>) : null;

  return {
    id,
    status,
    email: text(row.email),
    sourceLanguage: text(row.sourceLanguage),
    targetLanguage: text(row.targetLanguage) ?? "en",
    billablePages: amount(row.billablePages),
    totalCents: amount(row.totalCents),
    currency: text(row.currency) ?? "usd",
    createdAt,
    reviewReason: text(row.reviewReason),
    service: row.service === "diploma" || row.service === "course_by_course" ? row.service : null,
    equivalencyCredentials: equivalencyCredentials(row.evaluationResult),
    edge: parseEdge(row.edge),
    filename,
    pages,
    corrections,
    payment: payment && text(payment.status) ? { status: text(payment.status) as string, paidAt: text(payment.paidAt) } : null,
    delivery:
      delivery && text(delivery.status)
        ? {
            status: text(delivery.status) as string,
            approvedAt: text(delivery.approvedAt),
            deliveredAt: text(delivery.deliveredAt),
          }
        : null,
    originalUrl: text(row.originalUrl),
    translationUrl: text(row.translationUrl),
    qa: parseQa(row.qa),
    expedited: row.expedited === true,
    fulfillment: parseFulfillment(row.fulfillment),
  };
}

function parseEdge(value: unknown): StaffDetail["edge"] {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.title);
  if (!title) return null;
  const scale = row.gradingScale && typeof row.gradingScale === "object" ? (row.gradingScale as Record<string, unknown>) : null;
  const scaleTitle = scale ? text(scale.title) : null;
  const rows = scale && Array.isArray(scale.rows) ? scale.rows.flatMap(parseEdgeGrade) : [];
  return {
    title,
    levelNumber: amount(row.levelNumber),
    levelTitle: text(row.levelTitle),
    contentExcerpt: text(row.contentExcerpt) ?? "",
    url: text(row.url),
    gradingScale: scaleTitle ? { title: scaleTitle, rows } : null,
  };
}

function parseEdgeGrade(value: unknown): Array<{ indigenousGrade: string; usEquivalent: string }> {
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const indigenousGrade = text(row.indigenousGrade);
  const usEquivalent = text(row.usEquivalent);
  if (!indigenousGrade || !usEquivalent) return [];
  return [{ indigenousGrade, usEquivalent }];
}

function parseFulfillment(value: unknown): StaffDetail["fulfillment"] {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    mail: parseMailTask(row.mail),
    notarization: parseNotarizationTask(row.notarization),
  };
}

function parseMailTask(value: unknown): StaffDetail["fulfillment"]["mail"] {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = text(row.status);
  if (status !== "pending" && status !== "shipped") return null;
  return {
    status,
    trackingNumber: text(row.trackingNumber),
    address: parseAddress(row.address),
  };
}

function parseNotarizationTask(value: unknown): StaffDetail["fulfillment"]["notarization"] {
  if (!value || typeof value !== "object") return null;
  const status = text((value as Record<string, unknown>).status);
  if (status !== "pending" && status !== "done") return null;
  return { status };
}

function parseAddress(value: unknown): NonNullable<StaffDetail["fulfillment"]["mail"]>["address"] {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = text(row.name);
  const line1 = text(row.line1);
  const city = text(row.city);
  const state = text(row.state);
  const postalCode = text(row.postalCode);
  if (!name || !line1 || !city || !state || !postalCode || text(row.country) !== "US") return null;
  return { name, line1, line2: text(row.line2), city, state, postalCode, country: "US" };
}

export function parseNotes(body: unknown): StaffNote[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { notes?: unknown }).notes)) return null;
  const notes = (body as { notes: unknown[] }).notes.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const note = entry as Record<string, unknown>;
    const id = text(note.id);
    const bodyText = text(note.body);
    const createdAt = text(note.createdAt);
    if (!id || !bodyText || !createdAt) return [];
    return [{ id, authorId: text(note.authorId) ?? "", body: bodyText, createdAt }];
  });
  return notes;
}
