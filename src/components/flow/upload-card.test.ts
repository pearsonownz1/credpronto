import { readFileSync } from "node:fs";
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

import { clearUploadDraft, writeUploadDraft } from "./upload-draft";
import { UploadCard } from "./upload-card";
import { UploadExperience, UploadPageFallback, UploadView } from "./upload-view";

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
    expect(markup).toContain("Get my quote");
    expect(markup).not.toContain("Continue to payment");
    expect(markup).not.toMatch(/data-testid="email"[^>]*required/);
    expect(markup.match(/type="email"/g)).toHaveLength(1);
    expect(markup).not.toContain("Preview link goes to");
    expect(markup).not.toContain("Wrong email? Fix it");
  });

  it("hides the email field when a session email is already known", () => {
    const markup = html("ada@example.com");
    expect(markup).toContain("Preview link goes to ada@example.com");
    expect(markup).not.toContain("Wrong email? Fix it");
    expect(markup).not.toContain('data-testid="fix-email"');
    expect(markup).not.toContain("Email for your preview link");
    expect(markup).not.toContain('data-testid="email"');
  });

  it("does not render an email field in the loading fallback", () => {
    const markup = renderToStaticMarkup(createElement(UploadPageFallback));
    expect(markup).not.toContain('type="email"');
    expect(markup).toContain("Loading the upload form");
  });

  it("keeps the form out of the first render so a service choice cannot wipe typed fields", () => {
    const markup = renderToStaticMarkup(createElement(UploadExperience, { seed: null }));
    expect(markup).toContain("Loading the upload form");
    expect(markup).not.toContain('type="email"');
    expect(markup).not.toContain('data-testid="file-input"');
    expect(markup).not.toContain('data-testid="choice-diploma"');
  });
});

describe("service checkboxes", () => {
  it("draws square checkboxes with a check mark instead of radio bullets", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const rule = css.slice(css.indexOf(".service-check {"), css.indexOf(".service-check:hover"));
    expect(rule).toContain("appearance: none");
    expect(rule).toContain("border-radius: 4px");
    expect(rule).toContain("background: #ffffff");
    expect(css).toContain(".service-check:checked + .service-check-mark");
    expect(css).toMatch(/\.service-check:checked\s*\{[^}]*background:\s*#1f5eff/);
    expect(css).toMatch(/\.service-check-mark\s*\{[^}]*color:\s*#ffffff/);

    const markup = html(null);
    expect(markup.match(/class="service-check"/g)).toHaveLength(3);
    expect(markup.match(/class="service-check-mark"/g)).toHaveLength(3);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("rounded-full");
  });

  it("checks translation by default and leaves the evaluations off", () => {
    const markup = html(null);
    expect(markup).toContain("What do you need?");
    expect(markup).toContain("Choose any combination.");
    expect(markup).not.toContain('type="radio"');
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
    expect(markup).toMatch(/data-testid="choice-translation"[^>]*checked=""/);
    expect(markup).not.toMatch(/data-testid="choice-diploma"[^>]*checked=""/);
    expect(markup).not.toMatch(/data-testid="choice-course_by_course"[^>]*checked=""/);
    expect(markup).toContain('data-testid="translation-pages"');
    expect(markup).toContain("Pages: counting…");
    expect(markup).toContain('data-testid="file-input"');
    expect(markup).toContain('data-testid="file-input" type="file" multiple');
    expect(markup).toContain('data-testid="choice-total"');
    expect(markup).toContain("counting…");
    expect(markup).not.toContain('data-testid="degree-count"');
    expect(markup).not.toContain('type="number"');
    expect(markup).not.toContain("You can add a certified translation");
  });

  it("checks only the evaluation named in the link", () => {
    const diploma = html(null, "diploma");
    expect(diploma).toMatch(/data-testid="choice-diploma"[^>]*checked=""/);
    expect(diploma).not.toMatch(/data-testid="choice-translation"[^>]*checked=""/);
    expect(diploma).not.toMatch(/data-testid="choice-course_by_course"[^>]*checked=""/);
    expect(diploma).toContain('data-testid="degree-count"');
    expect(diploma).toContain("Degrees");
    expect(diploma).toContain('data-testid="degree-value"');
    expect(diploma).toContain('aria-label="Decrease degrees"');
    expect(diploma).toContain('aria-label="Increase degrees"');
    expect(diploma).toMatch(/data-testid="choice-price-diploma"[^>]*>\s*\$19\.95\s*</);
    expect(diploma).toMatch(/data-testid="choice-total-amount"[^>]*>\s*\$19\.95\s*</);
    expect(diploma).not.toContain("Pages:");
    expect(diploma).toContain("You can add a certified translation at $9.95/page.");
    expect(diploma).toContain("Staff sign off before the report is released.");
    expect(diploma).toContain("Email for your order");
    expect(diploma).not.toContain("Email for your preview link");
    expect(diploma).toContain("Continue to payment");
    expect(diploma).not.toContain("Get my quote");
    expect(diploma).toContain('data-testid="get-quote"');

    const course = html(null, "course_by_course");
    expect(course).toMatch(/data-testid="choice-course_by_course"[^>]*checked=""/);
    expect(course).not.toMatch(/data-testid="choice-translation"[^>]*checked=""/);
    expect(course).not.toMatch(/data-testid="choice-diploma"[^>]*checked=""/);
    expect(course).toContain("Continue to payment");
    expect(course).toContain("You can add a certified translation at $9.95/page.");
  });

  it("hides the translation add-on line when translation is already checked", () => {
    writeUploadDraft({
      email: "",
      files: [],
      checks: { translation: true, diploma: true, courseByCourse: true },
      degrees: "1",
      serviceKey: "",
    });
    try {
      const markup = html(null);
      expect(markup).toMatch(/data-testid="choice-translation"[^>]*checked=""/);
      expect(markup).toMatch(/data-testid="choice-diploma"[^>]*checked=""/);
      expect(markup).toMatch(/data-testid="choice-course_by_course"[^>]*checked=""/);
      expect(markup).not.toContain("You can add a certified translation");
      expect(markup).toContain("Staff sign off before the report is released.");
    } finally {
      clearUploadDraft();
    }
  });

  it("shows the flat fee and the pay step when the page is a diploma upload", () => {
    const markup = renderToStaticMarkup(
      createElement(UploadView, { initialService: "diploma", sessionEmail: null }),
    );
    expect(markup).toContain("Diploma evaluation is $19.95 per degree");
    expect(markup).toContain("Course-by-course is $39.95 per degree");
    expect(markup).toContain("You pay next.");
    expect(markup).not.toContain("watermarked");
    expect(markup).not.toContain('data-step="quote"');
    expect(markup).not.toContain('data-step="preview"');
    expect(markup).toContain("Continue to payment");
  });
});
