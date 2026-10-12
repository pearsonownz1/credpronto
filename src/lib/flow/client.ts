import { evaluationQuote } from "@/lib/orders/evaluation-price";
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

export type ConfirmInput = {
  sourceLanguage: string;
  documents: ConfirmDocumentInput[];
};

export type CheckoutResult =
  | { url: string; sessionId: string }
  | { mode: "paid_test"; paymentStatus: "paid_test"; orderStatus: "paid" };

export type FlowClient = {
  upload(input: { email: string; files: File[]; choice?: UploadChoice }): Promise<{
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
    file: "translation" | "certification",
  ): Promise<{ url: string; expiresInSeconds: number }>;
  replaceDocument(token: string, documentId: string, file: File): Promise<CustomerOrder>;
  updateTargetLanguage(token: string, targetLanguage: string): Promise<CustomerOrder>;
  updateQuote(
    token: string,
    body: { skipPages: number[]; targetLanguage?: string },
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

const liveClient: FlowClient = {
  upload({ email, files, choice = { orderType: "translation" } }) {
    const form = new FormData();
    form.set("email", email);
    appendOrderChoice(form, choice);
    for (const file of dedupeUploads(files)) form.append("files", file);
    return request("/api/orders", { method: "POST", body: form });
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
  });
  return {
    ...base,
    orderType: "evaluation",
    service: choice.service,
    degreeCount: choice.degreeCount,
    evaluationCents: quote.evaluationCents,
    translationCents: quote.translationCents,
    totalCents: quote.totalCents,
    lineItems: quote.lineItems,
  };
}

const mockClient: FlowClient = {
  async upload({ email, choice = { orderType: "translation" } }) {
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
    const next: CustomerOrder = {
      ...current,
      status: "processing",
      sourceLanguage: body.sourceLanguage,
      languageConfirmed: true,
      confirmations: current.confirmations.map((field) => {
        const document = body.documents.find((item) => item.documentId === field.documentId);
        if (!document) return field;
        const value = (document as Record<string, string>)[field.fieldKey];
        return {
          ...field,
          confirmedValue: typeof value === "string" ? value : field.confirmedValue,
        };
      }),
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
    const translationCents =
      next.orderType === "evaluation"
        ? next.sourceLanguage === "en"
          ? 0
          : billablePages * next.unitPriceCents
        : null;
    const totalCents =
      next.orderType === "evaluation" && next.evaluationCents != null
        ? next.evaluationCents + (translationCents ?? 0)
        : billablePages * next.unitPriceCents;
    const saved: CustomerOrder = {
      ...next,
      billablePages,
      totalCents,
      ...(translationCents != null ? { translationCents } : {}),
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
