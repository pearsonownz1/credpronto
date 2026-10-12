import { evaluationQuote, lineItemsForOrder, translationOfferCents } from "@/lib/orders/evaluation-price";
import { languagesEqual } from "@/lib/orders/languages";
import type { CustomerOrder, PreviewResponse } from "@/lib/orders/view";
import { appendOrderChoice, type UploadChoice } from "./order-choice";
import { quoteCounts } from "./present";
import { dedupeUploads } from "./uploads";
import { sampleCustomerOrder } from "./sample-order";
import {
  EMAIL_KEY,
  MOCK_TOKEN,
  ORDER_EVENT,
  TOKEN_KEY,
  writeEmail,
  writeToken,
} from "./session";

const MOCK_ORDER_KEY = "credpronto-mock-order";

export class FlowApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FlowApiError";
    this.status = status;
  }
}

export type ConfirmDocumentInput = {
  documentId: string;
  full_name: string;
  date_of_birth: string;
  parent_names: string;
  place_of_birth: string;
  date_format: string;
};

export type EvaluationConfirmDocument = {
  documentId: string;
  holder_name: string;
  school: string;
  degree: string;
  dates_attended: string;
  date_awarded: string;
};

export type ConfirmInput = {
  sourceLanguage: string;
  documents?: Array<ConfirmDocumentInput | EvaluationConfirmDocument>;
  includeTranslation?: boolean;
};

export type CheckoutResult =
  | { url: string; sessionId: string }
  | { mode: "paid_test"; paymentStatus: "paid_test"; orderStatus: "paid" };

export type FlowClient = {
  upload(input: {
    email: string;
    files: File[];
    choice?: UploadChoice;
    onProgress?: (ratio: number) => void;
  }): Promise<{
    orderToken: string;
    orderId: string;
  }>;
  getOrder(token: string): Promise<CustomerOrder>;
  confirm(token: string, body: ConfirmInput): Promise<CustomerOrder>;
  process(token: string): Promise<CustomerOrder>;
  preview(token: string): Promise<PreviewResponse>;
  correct(
    token: string,
    body: { documentId: string; page: number; note: string; passage?: string | null },
  ): Promise<{ id: string; status: string }>;
  checkout(
    token: string,
    body?: {
      addons?: string[];
      shippingAddress?: {
        name: string;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        postalCode: string;
        country: string;
      };
    },
  ): Promise<CheckoutResult>;
  download(
    token: string,
    file: "translation" | "certification" | "evaluation",
  ): Promise<{ url: string; expiresInSeconds: number }>;
  replaceDocument(token: string, documentId: string, file: File): Promise<CustomerOrder>;
  updateTargetLanguage(token: string, targetLanguage: string): Promise<CustomerOrder>;
  updateQuote(
    token: string,
    body: { skipPages?: number[]; targetLanguage?: string; includeTranslation?: boolean },
  ): Promise<CustomerOrder>;
  /** Mock walk-through moves a quoted order to preview_ready before checkout. */
  markPreviewReady(token: string): Promise<void>;
  /** Short-lived URL for the original upload. `{ url, expiresAt }`. */
  sourceFile(token: string, fileId: string): Promise<{ url: string; expiresAt: string }>;
};

export function flowUsesMock(): boolean {
  return process.env.NEXT_PUBLIC_FLOW_MOCK === "1";
}

export function getFlowClient(): FlowClient {
  return flowUsesMock() ? mockClient : liveClient;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let body: { error?: unknown } = {};
  if (text) {
    try {
      body = JSON.parse(text) as { error?: unknown };
    } catch {
      body = {};
    }
  }
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "Request failed";
    throw new FlowApiError(message, response.status);
  }
  return body as T;
}

function postForm<T>(path: string, form: FormData, onProgress?: (ratio: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new FlowApiError("Request failed", 0));
    xhr.onload = () => {
      const text = xhr.responseText;
      let body: { error?: unknown } = {};
      if (text) {
        try {
          body = JSON.parse(text) as { error?: unknown };
        } catch {
          body = {};
        }
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = typeof body.error === "string" ? body.error : "Request failed";
        reject(new FlowApiError(message, xhr.status));
        return;
      }
      resolve(body as T);
    };
    xhr.send(form);
  });
}

const liveClient: FlowClient = {
  upload({ email, files, choice = { orderType: "translation" }, onProgress }) {
    const form = new FormData();
    form.set("email", email);
    appendOrderChoice(form, choice);
    for (const file of dedupeUploads(files)) form.append("files", file);
    if (typeof XMLHttpRequest === "undefined") {
      return request("/api/orders", { method: "POST", body: form });
    }
    return postForm("/api/orders", form, onProgress);
  },
  getOrder(token) {
    return request(`/api/orders/${encodeURIComponent(token)}`);
  },
  confirm(token, body) {
    return request(`/api/orders/${encodeURIComponent(token)}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  process(token) {
    return request(`/api/orders/${encodeURIComponent(token)}/process`, { method: "POST" });
  },
  preview(token) {
    return request(`/api/orders/${encodeURIComponent(token)}/preview`);
  },
  correct(token, body) {
    return request(`/api/orders/${encodeURIComponent(token)}/corrections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  checkout(token, body = {}) {
    return request(`/api/orders/${encodeURIComponent(token)}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  download(token, file) {
    return request(
      `/api/orders/${encodeURIComponent(token)}/download?file=${file}`,
    );
  },
  async markPreviewReady() {},
  replaceDocument(token, documentId, file) {
    const form = new FormData();
    form.set("file", file);
    return request(
      `/api/orders/${encodeURIComponent(token)}/documents/${encodeURIComponent(documentId)}/replace`,
      { method: "POST", body: form },
    );
  },
  updateTargetLanguage(token, targetLanguage) {
    return request(`/api/orders/${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetLanguage }),
    });
  },
  updateQuote(token, body) {
    return request(`/api/orders/${encodeURIComponent(token)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  sourceFile(token, fileId) {
    return request(
      `/api/orders/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/source`,
    );
  },
};

function readMockOrder(): CustomerOrder {
  const base = sampleCustomerOrder();
  if (typeof window === "undefined") return base;
  const raw = sessionStorage.getItem(MOCK_ORDER_KEY);
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomerOrder>;
    return {
      ...base,
      ...parsed,
      documents: parsed.documents ?? base.documents,
      confirmations: parsed.confirmations ?? base.confirmations,
      payment: parsed.payment === undefined ? base.payment : parsed.payment,
      delivery: parsed.delivery === undefined ? base.delivery : parsed.delivery,
    };
  } catch {
    return base;
  }
}

function writeMockOrder(order: CustomerOrder) {
  sessionStorage.setItem(MOCK_ORDER_KEY, JSON.stringify(order));
  window.dispatchEvent(new Event(ORDER_EVENT));
}

function withEvaluationChoice(
  base: CustomerOrder,
  choice: Extract<UploadChoice, { orderType: "evaluation" }>,
): CustomerOrder {
  const billablePages = base.billablePages ?? 0;
  const quote = evaluationQuote({
    service: choice.service,
    degreeCount: choice.degreeCount,
    sourceLanguage: base.sourceLanguage,
    billablePages,
    includeTranslation: false,
  });
  return {
    ...base,
    orderType: "evaluation",
    service: choice.service,
    degreeCount: choice.degreeCount,
    evaluationCents: quote.evaluationCents,
    translationCents: quote.translationCents,
    includeTranslation: false,
    translationOfferCents: translationOfferCents({
      service: choice.service,
      sourceLanguage: base.sourceLanguage,
      billablePages,
      unitPriceCents: base.unitPriceCents,
    }),
    totalCents: quote.totalCents,
    lineItems: quote.lineItems,
  };
}

const MOCK_UPLOAD_HOLD_KEY = "credpronto-mock-upload-ms";

async function holdMockUpload(onProgress?: (ratio: number) => void) {
  if (typeof window === "undefined") return;
  const ms = Number(sessionStorage.getItem(MOCK_UPLOAD_HOLD_KEY));
  if (!Number.isFinite(ms) || ms <= 0) return;
  const started = Date.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = Date.now() - started;
      onProgress?.(Math.min(1, elapsed / ms));
      if (elapsed >= ms) resolve();
      else window.setTimeout(tick, 40);
    };
    tick();
  });
}

const mockClient: FlowClient = {
  async upload({ email, choice = { orderType: "translation" }, onProgress }) {
    await holdMockUpload(onProgress);
    const order =
      choice.orderType === "evaluation"
        ? withEvaluationChoice(sampleCustomerOrder(), choice)
        : sampleCustomerOrder();
    writeToken(MOCK_TOKEN);
    writeEmail(email);
    writeMockOrder(order);
    return { orderToken: MOCK_TOKEN, orderId: order.orderId };
  },
  async getOrder() {
    return readMockOrder();
  },
  async confirm(_token, body) {
    const current = readMockOrder();
    const documents = body.documents ?? [];
    const confirmed = new Map(
      documents.flatMap((document) =>
        Object.entries(document)
          .filter((entry): entry is [string, string] => entry[0] !== "documentId" && typeof entry[1] === "string")
          .map(([fieldKey, value]) => [`${document.documentId}:${fieldKey}`, value]),
      ),
    );
    const seen = new Set(current.confirmations.map((field) => `${field.documentId}:${field.fieldKey}`));
    const confirmations = current.confirmations.map((field) => {
      const value = confirmed.get(`${field.documentId}:${field.fieldKey}`);
      return value == null ? field : { ...field, confirmedValue: value };
    });
    for (const [key, value] of confirmed) {
      if (seen.has(key)) continue;
      const [documentId, fieldKey] = key.split(":");
      if (!documentId || !fieldKey) continue;
      confirmations.push({ documentId, fieldKey, originalValue: null, confirmedValue: value });
    }
    const next: CustomerOrder = {
      ...current,
      status: "processing",
      sourceLanguage: body.sourceLanguage,
      languageConfirmed: true,
      progress: { ...current.progress, step: "translating" },
      confirmations,
    };
    writeMockOrder(next);
    return next;
  },
  async process() {
    const next = { ...readMockOrder(), status: "processing" as const };
    writeMockOrder(next);
    return next;
  },
  async preview() {
    const order = readMockOrder();
    return {
      status: "preview_ready",
      totalCents: order.totalCents,
      unitPriceCents: order.unitPriceCents,
      billablePages: order.billablePages,
      original: {
        url: "/samples/birth-certificate-es.pdf",
        pageCount: 3,
        pages: [1, 2, 3].map((number) => ({
          number,
          widthPt: 612,
          heightPt: 792,
          documentId: "acta",
          documentIndex: 0,
          documentName: "acta-nacimiento.pdf",
        })),
      },
      translation: {
        url: "/samples/birth-certificate-en.pdf",
        pageCount: 3,
        pages: [1, 2, 3].map((number) => ({
          number,
          widthPt: 612,
          heightPt: 792,
          documentId: "acta",
          documentIndex: 0,
          documentName: "acta-nacimiento.pdf",
        })),
        version: 1,
      },
      report: null,
      corrections: [],
    };
  },
  async correct() {
    return { id: "mock-correction", status: "correction_requested" };
  },
  async checkout(token, body) {
    const current = readMockOrder();
    const addons = (body?.addons ?? current.addons).filter(
      (id): id is CustomerOrder["addons"][number] =>
        id === "notarization" || id === "mail" || id === "expedited",
    );
    writeMockOrder({
      ...current,
      addons,
      shippingAddress: body?.shippingAddress
        ? { ...body.shippingAddress, country: "US" }
        : addons.includes("mail")
          ? current.shippingAddress
          : null,
      status: "paid",
      payment: { status: "paid_test" },
      delivery: { status: "approved" },
    });
    writeToken(token || MOCK_TOKEN);
    return {
      url: `/order/${encodeURIComponent(token || MOCK_TOKEN)}?checkout=success`,
      sessionId: "cs_mock",
    };
  },
  async download(_token, file) {
    const href =
      file === "translation"
        ? "/samples/birth-certificate-en.pdf"
        : "/samples/birth-certificate-en.pdf";
    return { url: href, expiresInSeconds: 300 };
  },
  async markPreviewReady() {
    writeMockOrder({ ...readMockOrder(), status: "preview_ready" });
  },
  async updateTargetLanguage(_token, targetLanguage) {
    const current = readMockOrder();
    const quoted =
      current.sourceLanguage != null && !languagesEqual(current.sourceLanguage, targetLanguage);
    const next: CustomerOrder = {
      ...current,
      targetLanguage,
      ...(quoted ? { status: "quoted", reviewReason: null } : {}),
    };
    writeMockOrder(next);
    return next;
  },
  async updateQuote(_token, body) {
    if (typeof sessionStorage !== "undefined") {
      const forced = sessionStorage.getItem("credpronto-mock-quote-error");
      if (forced) {
        const status = Number(forced);
        throw new FlowApiError("We couldn't update that page.", Number.isInteger(status) ? status : 400);
      }
    }
    const current = readMockOrder();
    const skip = new Set(body.skipPages);
    const orderedLength = current.pageOrder?.pages.length ?? 0;
    const usePages = current.pages.length > 0 && current.pages.length >= orderedLength;
    const pages = usePages
      ? current.pages.map((page, index) => ({ ...page, skip: skip.has(index) }))
      : current.pages.map((page) => {
          if (!current.pageOrder) return page;
          const index = current.pageOrder.pages.findIndex(
            (row) =>
              row.documentId === page.documentId &&
              (page.uploadPage === row.uploadPage || page.pageNumber === row.appliedPage),
          );
          return index >= 0 ? { ...page, skip: skip.has(index) } : page;
        });
    const pageOrder = current.pageOrder
      ? {
          ...current.pageOrder,
          pages: current.pageOrder.pages.map((page, index) => {
            if (!usePages) return { ...page, skip: skip.has(index) };
            const matchIndex = current.pages.findIndex(
              (item) =>
                item.documentId === page.documentId &&
                ((item.uploadPage != null && item.uploadPage === page.uploadPage) ||
                  item.pageNumber === page.appliedPage),
            );
            return matchIndex >= 0 ? { ...page, skip: skip.has(matchIndex) } : page;
          }),
        }
      : current.pageOrder;
    const next: CustomerOrder = {
      ...current,
      pages,
      pageOrder,
      ...(body.targetLanguage ? { targetLanguage: body.targetLanguage } : {}),
    };
    const billablePages = quoteCounts(next).billable;
    const evaluationOrder = next.orderType === "evaluation" || next.service != null;
    const wantsTranslation = body.includeTranslation ?? next.includeTranslation;
    const translationCents = evaluationOrder
      ? wantsTranslation && next.sourceLanguage && next.sourceLanguage !== "en"
        ? billablePages * next.unitPriceCents
        : 0
      : null;
    const includeTranslation = evaluationOrder ? (translationCents ?? 0) > 0 : next.includeTranslation;
    const totalCents =
      evaluationOrder && next.evaluationCents != null
        ? next.evaluationCents + (translationCents ?? 0)
        : billablePages * next.unitPriceCents;
    const saved: CustomerOrder = {
      ...next,
      billablePages,
      totalCents,
      includeTranslation,
      translationOfferCents: translationOfferCents({
        service: next.service,
        sourceLanguage: next.sourceLanguage,
        billablePages,
        unitPriceCents: next.unitPriceCents,
      }),
      ...(translationCents != null ? { translationCents } : {}),
      ...(evaluationOrder && next.service && next.degreeCount != null && next.evaluationCents != null
        ? {
            lineItems: lineItemsForOrder({
              service: next.service,
              degreeCount: next.degreeCount,
              evaluationCents: next.evaluationCents,
              translationCents,
              billablePages,
            }),
          }
        : {}),
    };
    writeMockOrder(saved);
    return saved;
  },
  async sourceFile(_token, fileId) {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("credpronto-mock-source-missing") === "1") {
      throw new FlowApiError("Not found", 404);
    }
    const name =
      readMockOrder().documents.find((document) => document.id === fileId)?.filename.toLowerCase() ?? "";
    const url = name.endsWith(".pdf") || !name
      ? "/samples/birth-certificate-es.pdf"
      : "/samples/cover-cert-sample.png";
    return { url, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  },
  async replaceDocument(_token, documentId) {
    const current = readMockOrder();
    const next: CustomerOrder = {
      ...current,
      status: "draft",
      reviewReason: null,
      pages: current.pages.map((page) =>
        page.documentId === documentId ? { ...page, qualityMessage: null, qualityFlags: [] } : page,
      ),
    };
    writeMockOrder(next);
    return next;
  },
};

export { EMAIL_KEY, MOCK_ORDER_KEY, TOKEN_KEY };
