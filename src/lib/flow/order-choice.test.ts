import { describe, expect, it } from "vitest";
import {
  choiceFields,
  parseEvaluationService,
  uploadChoiceFromChecks,
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

  it("sends includeTranslation only when a translation is combined with an evaluation", () => {
    expect(uploadChoiceFromChecks({ translation: true, diploma: false, courseByCourse: false }, 1)).toEqual({
      orderType: "translation",
    });
    expect(choiceFields(uploadChoiceFromChecks({ translation: false, diploma: true, courseByCourse: false }, 1)!)).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "1",
      services: "diploma",
    });
    expect(
      choiceFields(uploadChoiceFromChecks({ translation: true, diploma: true, courseByCourse: false }, 1)!),
    ).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "1",
      includeTranslation: "true",
      services: "translation,diploma",
    });
    expect(
      choiceFields(uploadChoiceFromChecks({ translation: true, diploma: false, courseByCourse: true }, 2)!),
    ).toEqual({
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: "2",
      includeTranslation: "true",
      services: "translation,course_by_course",
    });
    expect(
      choiceFields(uploadChoiceFromChecks({ translation: false, diploma: true, courseByCourse: true }, 2)!),
    ).toEqual({
      orderType: "evaluation",
      degreeCount: "2",
      services: "diploma,course_by_course",
    });
    expect(
      choiceFields(uploadChoiceFromChecks({ translation: true, diploma: true, courseByCourse: true }, 1)!),
    ).toEqual({
      orderType: "evaluation",
      degreeCount: "1",
      includeTranslation: "true",
      services: "translation,diploma,course_by_course",
    });
    expect(uploadChoiceFromChecks({ translation: false, diploma: false, courseByCourse: false }, 1)).toBeNull();
    expect(uploadChoiceFromChecks({ translation: false, diploma: true, courseByCourse: false }, 0)).toBeNull();
    expect(uploadChoiceFromChecks({ translation: true, diploma: true, courseByCourse: false }, 6)).toBeNull();
    const five = uploadChoiceFromChecks({ translation: false, diploma: false, courseByCourse: true }, 5);
    expect(five?.orderType === "evaluation" ? five.degreeCount : null).toBe(5);
  });

  it("accepts only the two evaluation services", () => {
    expect(parseEvaluationService("diploma")).toBe("diploma");
    expect(parseEvaluationService("course_by_course")).toBe("course_by_course");
    expect(parseEvaluationService("translation")).toBeNull();
    expect(parseEvaluationService("option")).toBeNull();
  });
});
