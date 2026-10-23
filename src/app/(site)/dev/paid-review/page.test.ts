import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("@/components/flow/paid-review-fixture-preview", () => ({
  PaidReviewFixturePreview: () => createElement("div", { "data-testid": "fixture-preview" }),
}));

import Page from "./page";

describe("paid review fixture page", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the needs_review order on the paid review screen", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain("finishing your certified PDF");
    expect(html).toContain("Order CP-24802");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Paid $29.85");
    expect(html).not.toContain("Paid $29.85 on");
    expect(html).toContain("You can close this page.");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('data-testid="release-step-review" data-state="current"');
    expect(html).toContain('data-testid="fixture-preview"');
    expect(html).not.toContain("aria-valuenow");
  });

  it("404s in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => Page()).toThrow("NOT_FOUND");
  });
});
