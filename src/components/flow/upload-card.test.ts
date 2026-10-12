import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

import { UploadCard } from "./upload-card";
import { UploadPageFallback } from "./upload-view";

function html(sessionEmail?: string | null, initialService?: string | null) {
  return renderToStaticMarkup(createElement(UploadCard, { sessionEmail, initialService }));
}

describe("quote email field", () => {
  it("asks an anonymous visitor for an email the form validates itself", () => {
    const markup = html(null);
    expect(markup).toContain("noValidate");
    expect(markup).toContain("Email for your preview link");
    expect(markup).toContain('data-testid="email"');
    expect(markup).toContain('data-testid="get-quote"');
    expect(markup).not.toMatch(/data-testid="email"[^>]*required/);
    expect(markup.match(/type="email"/g)).toHaveLength(1);
    expect(markup).not.toContain("Preview link goes to");
  });

  it("hides the email field when a session email is already known", () => {
    const markup = html("ada@example.com");
    expect(markup).toContain("Preview link goes to ada@example.com");
    expect(markup).not.toContain("Email for your preview link");
    expect(markup).not.toContain('data-testid="email"');
  });

  it("does not render an email field in the loading fallback", () => {
    const markup = renderToStaticMarkup(createElement(UploadPageFallback));
    expect(markup).not.toContain('type="email"');
    expect(markup).toContain("Loading the upload form");
  });
});

describe("service checkboxes", () => {
  it("checks translation by default and leaves the evaluations off", () => {
    const markup = html(null);
    expect(markup).toContain("What do you need?");
    expect(markup).not.toContain('type="radio"');
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
    expect(markup).toMatch(/data-testid="choice-translation"[^>]*checked=""/);
    expect(markup).not.toMatch(/data-testid="choice-diploma"[^>]*checked=""/);
    expect(markup).not.toMatch(/data-testid="choice-course_by_course"[^>]*checked=""/);
    expect(markup).not.toContain('data-testid="degree-count"');
  });

  it("checks only the evaluation named in the link", () => {
    const diploma = html(null, "diploma");
    expect(diploma).toMatch(/data-testid="choice-diploma"[^>]*checked=""/);
    expect(diploma).not.toMatch(/data-testid="choice-translation"[^>]*checked=""/);
    expect(diploma).not.toMatch(/data-testid="choice-course_by_course"[^>]*checked=""/);
    expect(diploma).toContain('data-testid="degree-count"');

    const course = html(null, "course_by_course");
    expect(course).toMatch(/data-testid="choice-course_by_course"[^>]*checked=""/);
    expect(course).not.toMatch(/data-testid="choice-translation"[^>]*checked=""/);
    expect(course).not.toMatch(/data-testid="choice-diploma"[^>]*checked=""/);
  });
});
