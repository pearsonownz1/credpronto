import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  delayed: false,
  status: "processing",
  orderType: "translation",
  progressStep: "translating",
  previewVersion: null as number | null,
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
      previewVersion: state.previewVersion,
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
    expect(markup).toContain("Usually ready in a few minutes. We&#x27;ll email you when your preview is ready.");
    expect(markup).not.toContain("reading-fill");
    expect(markup).not.toContain("reading-shine");
    expect(markup).toContain('data-testid="preview-steps"');
    expect(markup).toContain('data-testid="preview-step-translating"');
    expect(markup).toContain('data-state="current"');
    expect(markup).toContain("Translating and laying out");
    expect(markup).not.toContain("Your preview is ready");
    expect(markup).not.toContain('data-testid="view-preview"');
    const value = Number(markup.match(/aria-valuenow="(\d+)"/)?.[1]);
    expect(value).toBe(92);
    expect(value).not.toBe(75);
  });

  it("shows the delayed line from the order flag", () => {
    state.delayed = true;
    state.status = "processing";
    state.progressStep = "translating";
    const markup = html();
    expect(markup).toContain("Taking longer than usual, we&#x27;re on it.");
    expect(markup).toContain('data-testid="translation-delayed"');
    expect(markup).toContain("Translating your document");
    expect(markup).not.toContain('data-testid="view-preview"');
  });

  it("keeps the delayed line and the bar when review starts before a preview exists", () => {
    state.delayed = true;
    state.status = "needs_review";
    state.progressStep = "done";
    const markup = html();
    expect(markup).toContain("Taking longer than usual, we&#x27;re on it.");
    expect(markup).toContain('data-testid="translation-delayed"');
    expect(markup).toContain("Translating your document");
    expect(markup).not.toContain("Your preview is ready");
    expect(markup).not.toContain('data-testid="view-preview"');
    expect(markup).toContain('aria-valuenow="92"');
    expect(markup).not.toContain('aria-valuenow="75"');
    state.status = "processing";
    state.progressStep = "translating";
  });

  it("shows the preview button when progress.step is done, before the status field catches up", () => {
    state.delayed = false;
    state.status = "processing";
    state.previewVersion = null;
    state.progressStep = "done";
    const markup = html();
    expect(markup).toContain("Your preview is ready");
    expect(markup).toContain('data-testid="view-preview"');
    expect(markup).not.toContain('data-testid="preview-steps"');
    expect(markup).not.toContain("Translating and laying out");
    state.progressStep = "translating";
  });

  it("shows the preview button only after the preview exists", () => {
    state.delayed = false;
    state.status = "preview_ready";
    state.previewVersion = null;
    state.progressStep = "translating";
    const markup = html();
    expect(markup).toContain("Your preview is ready");
    expect(markup).toContain('data-testid="view-preview"');
    expect(markup).toContain("View preview");
    expect(markup).not.toContain("Usually ready in a few minutes");
    expect(markup).not.toContain('data-testid="preview-steps"');
    expect(markup).not.toContain('data-testid="progress-bar"');
  });
});
