import { describe, expect, it } from "vitest";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import {
  COURSE_BY_COURSE_CENTS,
  COURSE_BY_COURSE_DETAIL,
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_DETAIL,
  DIPLOMA_EVALUATION_CENTS,
  DIPLOMA_PRICE_LABEL,
  EVALUATIONS_CANONICAL_URL,
  TRANSLATION_ADDON,
  TRANSLATION_PAGE_LABEL,
  evaluationCopyPromisesTurnaround,
  evaluationMarketingLines,
} from "./catalog";
import { COURSE_SAMPLE, DIPLOMA_SAMPLE } from "./sample";

describe("evaluation prices", () => {
  it("prices a diploma evaluation at $19.95 per degree", () => {
    expect(DIPLOMA_EVALUATION_CENTS).toBe(1995);
    expect(DIPLOMA_PRICE_LABEL).toBe("$19.95 per degree");
    expect(DIPLOMA_DETAIL).toBe("U.S. equivalency of the degree");
  });

  it("prices course-by-course at $39.95 per degree", () => {
    expect(COURSE_BY_COURSE_CENTS).toBe(3995);
    expect(COURSE_BY_COURSE_PRICE_LABEL).toBe("$39.95 per degree");
    expect(COURSE_BY_COURSE_DETAIL).toBe(
      "Each course converted to U.S. semester hours and grade, plus GPA.",
    );
  });

  it("adds certified translation at $9.95/page on one invoice", () => {
    expect(UNIT_PRICE_CENTS).toBe(995);
    expect(TRANSLATION_PAGE_LABEL).toBe("$9.95/page");
    expect(TRANSLATION_ADDON).toBe(
      "You can add a certified translation at $9.95/page. It is charged only if you choose it, on the same invoice.",
    );
  });

  it("uses the www canonical for the evaluations page", () => {
    expect(EVALUATIONS_CANONICAL_URL).toBe("https://www.credpronto.com/evaluations");
  });

  it("does not promise a timed turnaround", () => {
    expect(evaluationCopyPromisesTurnaround()).toBe(false);
    expect(evaluationMarketingLines().join(" ")).toMatch(/staff sign off before/i);
    expect(evaluationMarketingLines().join(" ")).toMatch(/watermarked report/i);
  });
});

describe("evaluation sample", () => {
  it("uses the diploma example", () => {
    expect(DIPLOMA_SAMPLE.preparedFor).toBe("María Fernanda Ruiz Delgado");
    expect(DIPLOMA_SAMPLE.equivalency).toContain("Bachelor's degree in Industrial Engineering");
    expect(DIPLOMA_SAMPLE.reportId).toBe("CP-E-10482");
  });

  it("uses the course-by-course example", () => {
    expect(COURSE_SAMPLE.gpa).toBe("3.36");
    expect(COURSE_SAMPLE.semesterHours).toBe("142.0");
    expect(COURSE_SAMPLE.years[0]?.courses[0]?.name).toBe("Cálculo Diferencial");
    expect(COURSE_SAMPLE.years.flatMap((year) => year.courses)).toHaveLength(9);
  });
});
