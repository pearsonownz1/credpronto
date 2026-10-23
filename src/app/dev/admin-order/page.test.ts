import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/dev/admin-order",
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function PreviewStub() {
      return null;
    },
}));

vi.mock("@/lib/account/actions", () => ({
  signOut: () => undefined,
}));

import Page from "./page";

describe("admin order fixture page", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows one upload box per purchased evaluation report", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain("CP-24910");
    expect(html).toContain("Approve and release");
    expect(html).toContain("Still missing: Course-by-course evaluation");
    expect(html).toContain('data-testid="evaluation-report-diploma"');
    expect(html).toContain('data-testid="evaluation-report-course_by_course"');
    expect(html).toContain("diploma-evaluation.pdf");
    expect(html).toContain('data-testid="evaluation-summaries"');
    expect(html).toContain('data-testid="evaluation-summary-diploma"');
    expect(html).toContain('data-testid="evaluation-summary-course_by_course"');
    expect(html).toContain("Not generated yet.");
    expect(html).toContain("Generate missing evaluations");
    expect(html).toContain('data-testid="evaluation-status"');
    const missing = html.indexOf("Still missing: Course-by-course evaluation");
    const approve = html.indexOf("Approve and release");
    expect(missing).toBeGreaterThan(-1);
    expect(approve).toBeGreaterThan(missing);
    expect(approve - missing).toBeLessThan(600);
  });

  it("404s in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => Page()).toThrow("NOT_FOUND");
  });
});
