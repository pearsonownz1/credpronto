import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ delayed: false }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("./use-order", () => ({
  useStoredToken: () => "token-1",
  useCustomerOrder: () => ({
    order: {
      orderId: "CP-1",
      status: "processing",
      orderType: "translation",
      delayed: state.delayed,
      documents: [],
      billablePages: 2,
    },
    error: null,
    loading: false,
    reload: () => undefined,
  }),
}));

import { ProcessingView } from "./processing-view";

describe("processing view", () => {
  it("tells the customer when a preview is taking longer than usual", () => {
    state.delayed = true;
    const html = renderToStaticMarkup(createElement(ProcessingView, { token: "token-1" }));
    expect(html).toContain("Taking longer than usual, we&#x27;re on it.");
    expect(html).toContain('data-testid="translation-delayed"');
  });

  it("keeps the usual wait copy before the delay", () => {
    state.delayed = false;
    const html = renderToStaticMarkup(createElement(ProcessingView, { token: "token-1" }));
    expect(html).not.toContain("translation-delayed");
    expect(html).toContain("Translating your documents…");
  });
});