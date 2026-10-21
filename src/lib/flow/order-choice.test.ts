import { describe, expect, it } from "vitest";
import {
  choiceFields,
  orderRequestChoice,
  parseEvaluationService,
  serviceRequestFromOrder,
  uploadChoiceFromChecks,
  uploadChoiceFromSelection,
} from "./order-choice";

describe("upload order choice", () => {
  it("leaves a translation upload on the default order type", () => {
    expect(choiceFields(uploadChoiceFromSelection("translation", 1))).toEqual({});
    expect(orderRequestChoice(uploadChoiceFromSelection("translation", 1))).toEqual({
      orderType: "translation",
      services: ["translation"],
    });
  });

  it("sends an evaluation with service and degreeCount", () => {
    expect(choiceFields(uploadChoiceFromSelection("diploma", 1))).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "1",
      services: "diploma",
    });
    expect(choiceFields(uploadChoiceFromSelection("course_by_course", 2))).toEqual({
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: "2",
      services: "course_by_course",
    });
  });

  it("sends includeTranslation only when a translation is combined with an evaluation", () => {
    expect(uploadChoiceFromChecks({ translation: true, diploma: false, courseByCourse: false }, 1)).toEqual({
      orderType: "translation",
      services: ["translation"],
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
      service: "diploma",
      degreeCount: "2",
      services: "diploma,course_by_course",
    });
    expect(
      choiceFields(uploadChoiceFromChecks({ translation: true, diploma: true, courseByCourse: true }, 1)!),
    ).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "1",
      includeTranslation: "true",
      services: "translation,diploma,course_by_course",
    });
    expect(uploadChoiceFromChecks({ translation: false, diploma: false, courseByCourse: false }, 1)).toBeNull();
    expect(uploadChoiceFromChecks({ translation: true, diploma: true, courseByCourse: true }, 2)).toMatchObject({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: 2,
      includeTranslation: true,
      services: ["translation", "diploma", "course_by_course"],
    });
    expect(orderRequestChoice(uploadChoiceFromChecks({ translation: true, diploma: true, courseByCourse: true }, 2)!)).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "2",
      includeTranslation: true,
      services: ["translation", "diploma", "course_by_course"],
    });
    expect(uploadChoiceFromChecks({ translation: false, diploma: true, courseByCourse: true }, 1)).toMatchObject({
      service: "diploma",
      includeTranslation: false,
      services: ["diploma", "course_by_course"],
    });
    expect(orderRequestChoice(uploadChoiceFromChecks({ translation: false, diploma: true, courseByCourse: true }, 1)!)).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "1",
      includeTranslation: false,
      services: ["diploma", "course_by_course"],
    });
    expect(uploadChoiceFromChecks({ translation: false, diploma: true, courseByCourse: false }, 0)).toBeNull();
    expect(uploadChoiceFromChecks({ translation: true, diploma: true, courseByCourse: false }, 6)).toBeNull();
    const five = uploadChoiceFromChecks({ translation: false, diploma: false, courseByCourse: true }, 5);
    expect(five?.orderType === "evaluation" ? five.degreeCount : null).toBe(5);
  });

  it("quotes and checks out with the same checked services and the older fields", () => {
    expect(
      serviceRequestFromOrder(
        {
          services: ["course_by_course", "translation", "diploma"],
          service: null,
          includeTranslation: true,
          degreeCount: 2,
          orderType: "evaluation",
        },
        { includeTranslation: false },
      ),
    ).toEqual({
      orderType: "evaluation",
      service: "diploma",
      degreeCount: "2",
      includeTranslation: false,
      services: ["diploma", "course_by_course"],
    });
    expect(
      serviceRequestFromOrder({
        service: "course_by_course",
        includeTranslation: true,
        degreeCount: 3,
        orderType: "evaluation",
      }),
    ).toEqual({
      orderType: "evaluation",
      service: "course_by_course",
      degreeCount: "3",
      includeTranslation: true,
      services: ["translation", "course_by_course"],
    });
  });

  it("accepts only the two evaluation services", () => {
    expect(parseEvaluationService("diploma")).toBe("diploma");
    expect(parseEvaluationService("course_by_course")).toBe("course_by_course");
    expect(parseEvaluationService("translation")).toBeNull();
    expect(parseEvaluationService("option")).toBeNull();
  });
});
