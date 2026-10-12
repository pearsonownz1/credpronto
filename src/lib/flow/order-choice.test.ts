import { describe, expect, it } from "vitest";
import {
  choiceFields,
  evaluationsLive,
  parseEvaluationService,
  uploadChoiceFromSelection,
} from "./order-choice";

describe("upload order choice", () => {
  it("leaves a translation upload on the default order type", () => {
    expect(choiceFields(uploadChoiceFromSelection("translation", 1))).toEqual({});
  });

  it("sends an evaluation with service and degreeCount", () => {
    expect(choiceFields(uploadChoiceFromSelection("diploma", 1))).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "1",
    });
    expect(choiceFields(uploadChoiceFromSelection("course_by_course", 2))).toEqual({
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: "2",
    });
  });

  it("is off unless NEXT_PUBLIC_EVALUATIONS_LIVE is 1", () => {
    const previous = process.env.NEXT_PUBLIC_EVALUATIONS_LIVE;
    delete process.env.NEXT_PUBLIC_EVALUATIONS_LIVE;
    expect(evaluationsLive()).toBe(false);
    process.env.NEXT_PUBLIC_EVALUATIONS_LIVE = "1";
    expect(evaluationsLive()).toBe(true);
    process.env.NEXT_PUBLIC_EVALUATIONS_LIVE = "true";
    expect(evaluationsLive()).toBe(false);
    if (previous === undefined) delete process.env.NEXT_PUBLIC_EVALUATIONS_LIVE;
    else process.env.NEXT_PUBLIC_EVALUATIONS_LIVE = previous;
  });

  it("accepts only the two evaluation services", () => {
    expect(parseEvaluationService("diploma")).toBe("diploma");
    expect(parseEvaluationService("course_by_course")).toBe("course_by_course");
    expect(parseEvaluationService("translation")).toBeNull();
    expect(parseEvaluationService("option")).toBeNull();
  });
});
