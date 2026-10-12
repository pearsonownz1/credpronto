import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  delayed: false,
  status: "processing",
  orderType: "translation",
  progressStep: "translating",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("./use-order", () => ({
  useStoredToken: () => "token-1",
  useCustomerOrder: () => ({
    order: {
      orderId: "CP-1",
      status: state.status,
      orderType: state.orderType,
      delayed: state.delayed,
      documents: [],
      billablePages: 2,
      progress: { step: state.progressStep, pagesRead: 2, pagesTotal: 2 },
    },
    error: null,
    loading: false,
    reload: () => undefined,
  }),
}));

import { ProcessingView } from "./processing-view";

function html() {
  return renderToStaticMarkup(createElement(ProcessingView, { token: "token-1" }));
}

describe("processing view", () => {
  it("shows translation in progress from the order status, short of a full bar", () => {
    state.delayed = false;
    state.status = "processing";
    state.progressStep = "translating";
    const markup = html();
    expect(markup).toContain("Translating your document");
    expect(markup).toContain("Usually ready in about 10 minutes. We&#x27;ll email you when your preview is ready.");
    expect(markup).toContain('data-testid="preview-steps"');
    expect(markup).toContain('data-testid="preview-step-translating"');
    expect(markup).toContain('data-state="current"');
    expect(markup).toContain("Translating and laying out");
    expect(markup).not.toContain("Your preview is ready");
    expect(markup).not.toContain('data-testid="view-preview"');
    const value = Number(markup.match(/aria-valuenow="(\d+)"/)?.[1]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
  });

  it("tells the customer when a preview is taking longer than usual", () => {
    state.delayed = true;
    state.status = "processing";
    const markup = html();
    expect(markup).toContain("Taking longer than usual, we&#x27;re on it.");
    expect(markup).toContain('data-testid="translation-delayed"');
    expect(markup).not.toContain('data-testid="view-preview"');
  });

  it("shows the preview button only after the preview exists", () => {
    state.delayed = false;
    state.status = "preview_ready";
    state.progressStep = "translating";
    const markup = html();
    expect(markup).toContain("Your preview is ready");
    expect(markup).toContain('data-testid="view-preview"');
    expect(markup).toContain("View preview");
    expect(markup).not.toContain("Usually ready in about 10 minutes");
    expect(markup).not.toContain('data-testid="preview-steps"');
    expect(markup).not.toContain('data-testid="progress-bar"');
  });
});
