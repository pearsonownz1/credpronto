import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvaluationSummaries } from "./evaluation-summaries";

const reports = [{ service: "diploma" as const }, { service: "course_by_course" as const }];

describe("EvaluationSummaries", () => {
  it("shows each purchased evaluation that has not been generated", () => {
    const html = renderToStaticMarkup(
      createElement(EvaluationSummaries, {
        reports,
        summaries: [],
        canGenerate: true,
        pending: null,
        onGenerate: () => undefined,
      }),
    );

    expect(html).toContain('data-testid="evaluation-summary-diploma"');
    expect(html).toContain('data-testid="evaluation-summary-course_by_course"');
    expect(html).toContain("Not generated yet.");
    expect(html).toContain('data-testid="regenerate-evaluations"');
    expect(html).toContain("Generate missing evaluations");
  });

  it("shows the stored diploma and course-by-course lines", () => {
    const html = renderToStaticMarkup(
      createElement(EvaluationSummaries, {
        reports,
        summaries: [
          {
            service: "diploma",
            heading: "Diploma evaluation",
            lines: ["Licenciatura (Universidad Nacional) — Bachelor degree"],
          },
          {
            service: "course_by_course",
            heading: "Course-by-course evaluation",
            lines: ["Licenciatura (Universidad Nacional)", "GPA 3.5 · 120 US semester hours", "2018: Law — A"],
          },
        ],
        canGenerate: true,
        pending: null,
        onGenerate: () => undefined,
      }),
    );

    expect(html).toContain("Licenciatura (Universidad Nacional) — Bachelor degree");
    expect(html).toContain("GPA 3.5 · 120 US semester hours");
    expect(html).toContain("2018: Law — A");
    expect(html).not.toContain("Not generated yet.");
  });

  it("shows why a paid evaluation did not generate and links a stored PDF", () => {
    const html = renderToStaticMarkup(
      createElement(EvaluationSummaries, {
        reports: [
          { service: "diploma", url: "https://files.example/diploma-evaluation.pdf" },
          { service: "course_by_course" },
        ],
        summaries: [],
        problems: [
          {
            service: "course_by_course",
            reason: "Course-by-course evaluation could not be read from the uploaded pages.",
          },
        ],
        canGenerate: true,
        pending: null,
        onGenerate: () => undefined,
      }),
    );

    expect(html).toContain('data-testid="evaluation-pdf-diploma"');
    expect(html).toContain('href="https://files.example/diploma-evaluation.pdf"');
    expect(html).toContain("Open PDF");
    expect(html).toContain('data-testid="evaluation-problem-course_by_course"');
    expect(html).toContain("Course-by-course evaluation could not be read from the uploaded pages.");
    expect(html).not.toContain('data-testid="evaluation-pdf-course_by_course"');
  });
});
