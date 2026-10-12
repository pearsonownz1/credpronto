import type { CustomerOrder, PreviewResponse } from "@/lib/orders/view";
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
  upload(input: { email: string; files: File[] }): Promise<{
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
  checkout(token: string): Promise<CheckoutResult>;
  download(
    token: string,
    file: "translation" | "certification",
  ): Promise<{ url: string; expiresInSeconds: number }>;
  /** Mock walk-through moves a quoted order to preview_ready before checkout. */
  markPreviewReady(token: string): Promise<void>;
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
  upload({ email, files }) {
    const form = new FormData();
    form.set("email", email);
    for (const file of files) form.append("files", file);
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
  checkout(token) {
    return request(`/api/orders/${encodeURIComponent(token)}/checkout`, { method: "POST" });
  },
  download(token, file) {
    return request(
      `/api/orders/${encodeURIComponent(token)}/download?file=${file}`,
    );
  },
  async markPreviewReady() {},
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

const mockClient: FlowClient = {
  async upload({ email }) {
    const order = readMockOrder();
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
      corrections: [],
    };
  },
  async correct() {
    return { id: "mock-correction", status: "correction_requested" };
  },
  async checkout(token) {
    const current = readMockOrder();
    writeMockOrder({
      ...current,
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
};

export { EMAIL_KEY, MOCK_ORDER_KEY, TOKEN_KEY };
