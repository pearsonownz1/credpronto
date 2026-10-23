import { describe, expect, it } from "vitest";
import { COURSE_BY_COURSE_CENTS, DIPLOMA_EVALUATION_CENTS } from "@/lib/evaluations/catalog";
import { officialEvaluationButtonLabel } from "./official-label";

describe("official evaluation button price", () => {
  it("prices a diploma and a transcript from the catalog, and leaves an unknown kind unlabeled", () => {
    expect(DIPLOMA_EVALUATION_CENTS).toBe(1995);
    expect(COURSE_BY_COURSE_CENTS).toBe(3995);
    expect(officialEvaluationButtonLabel("diploma")).toBe("Get my official evaluation · $19.95");
    expect(officialEvaluationButtonLabel("transcript")).toBe("Get my official evaluation · $39.95");
    expect(officialEvaluationButtonLabel(null)).toBe("Get my official evaluation");
  });
});
