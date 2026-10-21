import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  delayed: false,
  status: "processing",
  orderType: "translation",
  progressStep: "translating",
  previewVersion: null as number | null,
  pagesDone: null as number | null,
  pagesTranslateTotal: null as number | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
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
      progress: {
        step: state.progressStep,
        pagesRead: 2,
        pagesTotal: 2,
        pagesDone: state.pagesDone,
        pagesTranslateTotal: state.pagesTranslateTotal,
      },
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
    expect(markup).toContain("Usually ready in 3 minutes. We&#x27;ll email you when your preview is ready.");
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

  it("stops the bar and explains the review when a finished translation needs review", () => {
    state.delayed = true;
    state.status = "needs_review";
    state.orderType = "translation";
    state.progressStep = "done";
    state.pagesDone = 9;
    state.pagesTranslateTotal = 9;
    const markup = html();
    expect(markup).toContain("A translator is reviewing your document");
    expect(markup).toContain("We&#x27;ll email you when it&#x27;s ready.");
    expect(markup).toContain('data-testid="translation-review"');
    expect(markup).not.toContain("as soon as your preview is ready");
    expect(markup).not.toContain("Usually ready in 3 minutes");
    expect(markup).not.toContain("Taking longer than usual");
    expect(markup).not.toContain("Translating your document");
    expect(markup).not.toContain("reading-spinner");
    expect(markup).not.toContain('data-testid="preview-steps"');
    expect(markup).not.toContain('data-testid="preview-percent"');
    expect(markup).not.toContain('data-testid="progress-bar"');
    expect(markup).not.toContain('aria-valuenow="98"');
    expect(markup).not.toContain('aria-valuenow="92"');
    expect(markup).not.toContain("Your preview is ready");
    expect(markup).not.toContain("Opening your preview");
    expect(markup).not.toContain('data-testid="view-preview"');
    state.delayed = false;
    state.status = "processing";
    state.progressStep = "translating";
    state.pagesDone = null;
    state.pagesTranslateTotal = null;
  });

  it("uses evaluator copy without a time estimate when an evaluation is in review", () => {
    state.delayed = true;
    state.status = "needs_review";
    state.orderType = "evaluation";
    state.progressStep = "done";
    state.pagesDone = 2;
    state.pagesTranslateTotal = 2;
    const markup = html();
    expect(markup).toContain("An evaluator is reviewing your document");
    expect(markup).toContain("We&#x27;ll email you as soon as it&#x27;s ready.");
    expect(markup).not.toContain("A translator is reviewing");
    expect(markup).not.toContain("usually within minutes");
    expect(markup).not.toContain("reading-spinner");
    expect(markup).not.toContain('data-testid="preview-percent"');
    expect(markup).not.toContain('data-testid="progress-bar"');
    state.delayed = false;
    state.orderType = "translation";
    state.status = "processing";
    state.progressStep = "translating";
    state.pagesDone = null;
    state.pagesTranslateTotal = null;
  });

  it("leaves the progress screen as soon as the preview step is done", () => {
    state.delayed = false;
    state.status = "processing";
    state.previewVersion = null;
    state.progressStep = "done";
    const markup = html();
    expect(markup).toContain("Opening your preview");
    expect(markup).not.toContain("Your preview is ready");
    expect(markup).not.toContain('data-testid="view-preview"');
    expect(markup).not.toContain("View preview");
    expect(markup).not.toContain('data-testid="preview-steps"');
    expect(markup).not.toContain("Translating and laying out");
    state.progressStep = "translating";
  });

  it("leaves the progress screen when the preview status is ready", () => {
    state.delayed = false;
    state.status = "preview_ready";
    state.previewVersion = null;
    state.progressStep = "translating";
    const markup = html();
    expect(markup).toContain("Opening your preview");
    expect(markup).not.toContain("Your preview is ready");
    expect(markup).not.toContain('data-testid="view-preview"');
    expect(markup).not.toContain("View preview");
    expect(markup).not.toContain("Usually ready in 3 minutes");
    expect(markup).not.toContain('data-testid="preview-steps"');
    expect(markup).not.toContain('data-testid="progress-bar"');
  });
});
