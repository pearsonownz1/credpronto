import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import ComboPage from "./paid-combo/page";
import EvaluationPage from "./paid-evaluation/page";
import ReadyPage from "./paid-ready/page";

describe("paid order fixture pages", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  it("shows a delivered translation on Ready with one download", () => {
    const html = renderToStaticMarkup(createElement(ReadyPage));
    expect(html).toContain("Your certified translation is ready.");
    expect(html).toContain("We also emailed you a copy.");
    expect(html).toContain('data-testid="package-step-ready" data-state="current"');
    expect(html).toContain('data-testid="download-certified"');
    expect(html).toContain("Start another order");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Order 11111111");
    expect(html).not.toContain("11111111-2222-4333-8444-555555555555");
    expect(html).not.toContain("Performing evaluation");
    expect(html).not.toContain("Final review");
    expect(html).not.toContain("Nothing to do.");
  });

  it("keeps a finished translation and a pending evaluation on Almost Ready without a download", () => {
    const html = renderToStaticMarkup(createElement(ComboPage));
    expect(html).toContain("finishing your certified PDF");
    expect(html).toContain("Nothing to do. We&#x27;ll email you when it&#x27;s ready.");
    expect(html).toContain('data-testid="package-step-almost_ready" data-state="current"');
    expect(html).toContain("Order 9b80cd30");
    expect(html).not.toContain("9b80cd30-0000-4000-8000-000000000001");
    expect(html).not.toContain('data-testid="download-certified"');
    expect(html).not.toContain('data-testid="download-evaluation"');
    expect(html).not.toContain("Performing layout");
    expect(html).not.toContain("Final review");
    expect(html).toContain('href="/dashboard"');
  });

  it("shows a paid evaluation on Quick Review without a download", () => {
    const html = renderToStaticMarkup(createElement(EvaluationPage));
    expect(html).toContain("finishing your certified PDF");
    expect(html).toContain('data-testid="package-step-quick_review" data-state="current"');
    expect(html).toContain("Order 22222222");
    expect(html).not.toContain('data-testid="download-evaluation"');
    expect(html).not.toContain("Performing evaluation");
    expect(html).not.toContain("Performing layout");
    expect(html).toContain('href="/dashboard"');
  });

  it("404s in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => ReadyPage()).toThrow("NOT_FOUND");
    expect(() => ComboPage()).toThrow("NOT_FOUND");
    expect(() => EvaluationPage()).toThrow("NOT_FOUND");
  });
});
