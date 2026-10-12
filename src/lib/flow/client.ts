import { sampleDraft } from "./mock-data";
import { priceDraft } from "./pricing";
import type { FlowDraft, FlowQuote } from "./types";

export const STORAGE_KEY = "credpronto-flow-draft";
export const STORAGE_EVENT = "credpronto-flow-draft";

/**
 * Customer-flow client. `getFlowClient()` is the in-browser mock.
 * Backend replaces that function with the order API; callers keep this shape.
 */
export type FlowClient = {
  load(): FlowDraft;
  save(draft: FlowDraft): void;
  price(draft: FlowDraft): FlowQuote;
};

export function parseDraft(raw: string): FlowDraft {
  const base = sampleDraft();
  if (!raw) return base;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    const value = parsed as Partial<FlowDraft>;
    return {
      ...base,
      ...value,
      files:
        Array.isArray(value.files) && value.files.length > 0
          ? value.files
          : base.files,
      details: { ...base.details, ...(value.details ?? {}) },
    };
  } catch {
    return base;
  }
}

function createMockClient(): FlowClient {
  return {
    load() {
      if (typeof window === "undefined") return sampleDraft();
      return parseDraft(sessionStorage.getItem(STORAGE_KEY) ?? "");
    },
    save(draft) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      window.dispatchEvent(new Event(STORAGE_EVENT));
    },
    price: priceDraft,
  };
}

export function getFlowClient(): FlowClient {
  return createMockClient();
}
