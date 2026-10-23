import { describe, expect, it } from "vitest";
import {
  evaluationSummaries,
  paidEvaluationPatch,
  pendingEvaluationWork,
} from "./evaluation-summary";
import type { EvaluationResult } from "./types";

const orderId = "5274b9e5-d50d-4cf8-8b47-757922b88431";

function diploma(): EvaluationResult {
  return {
    kind: "diploma",
    credentials: [
      {
        applicant: "Ada Lovelace",
        institution: "Universidad Nacional",
        country: "Mexico",
        credential: "Licenciatura",
        field: "Law",
        dates: "2018",
        usEquivalency: "Bachelor degree",
        documentsReviewed: ["diploma.pdf"],
      },
    ],
  };
}

function course(): EvaluationResult {
  return {
    kind: "course_by_course",
    applicant: "Ada Lovelace",
    institution: "Universidad Nacional",
    country: "Mexico",
    credential: "Licenciatura",
    years: [
      {
        year: "2018",
        courses: [
          {
            originalName: "Derecho",
            englishName: "Law",
            localCredits: 4,
            localGrade: "9",
            usSemesterHours: 3,
            usGrade: "A",
            gradePoints: 12,
          },
        ],
      },
    ],
    totalHours: 120,
    gpa: 3.5,
    gradeScale: "10-point",
  };
}

describe("pendingEvaluationWork", () => {
  it("asks for both reports when a paid bundle only stored the certified translation", () => {
    expect(
      pendingEvaluationWork({
        service: null,
        services: ["translation", "diploma", "course_by_course"],
        includeTranslation: true,
        orderType: "evaluation",
        evaluationResult: null,
        evaluationResults: null,
        serviceFiles: null,
        finalTranslationPath: `${orderId}/certified-translation-v1.pdf`,
        certificationPath: `${orderId}/certified-translation-v1.pdf`,
      }),
    ).toEqual([
      { service: "diploma", needsResult: true, needsFile: true },
      { service: "course_by_course", needsResult: true, needsFile: true },
    ]);
  });

  it("treats a finished single evaluation PDF as already stored", () => {
    expect(
      pendingEvaluationWork({
        service: "diploma",
        includeTranslation: false,
        evaluationResult: diploma(),
        finalTranslationPath: "order-1/evaluation-v1.pdf",
        certificationPath: "order-1/evaluation-v1.pdf",
      }),
    ).toEqual([]);
  });

  it("does not treat a certified translation as the diploma report", () => {
    expect(
      pendingEvaluationWork({
        service: "diploma",
        services: ["translation", "diploma"],
        includeTranslation: true,
        evaluationResult: null,
        finalTranslationPath: "order-1/certified-translation-v1.pdf",
        certificationPath: "order-1/certified-translation-v1.pdf",
      }),
    ).toEqual([{ service: "diploma", needsResult: true, needsFile: true }]);
  });
});

describe("paidEvaluationPatch", () => {
  it("stores both evaluations and leaves payment, status, and the translation path alone", () => {
    const patch = paidEvaluationPatch(
      {
        service: null,
        services: ["translation", "diploma", "course_by_course"],
        includeTranslation: true,
        evaluationResult: null,
        evaluationResults: null,
        serviceFiles: null,
        finalTranslationPath: `${orderId}/certified-translation-v1.pdf`,
      },
      [
        { service: "diploma", result: diploma(), path: "order-1/diploma-evaluation.pdf" },
        { service: "course_by_course", result: course(), path: "order-1/course_by_course-evaluation.pdf" },
      ],
    );

    expect(patch).not.toHaveProperty("total_cents");
    expect(patch).not.toHaveProperty("status");
    expect(patch).not.toHaveProperty("final_translation_path");
    expect(patch?.evaluation_result).toMatchObject({ kind: "diploma" });
    expect(patch?.evaluation_results).toHaveLength(2);
    expect(patch?.service_files).toEqual({
      diploma: "order-1/diploma-evaluation.pdf",
      course_by_course: "order-1/course_by_course-evaluation.pdf",
    });
    expect(evaluationSummaries([diploma(), course()]).map((summary) => summary.service)).toEqual([
      "diploma",
      "course_by_course",
    ]);
  });
});
