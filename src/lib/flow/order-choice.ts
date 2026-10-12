import type { EvaluationService } from "@/lib/orders/types";

/**
 * Customer upload fields from docs/api.md.
 * `service` is the evaluation kind (`diploma` or `course_by_course`).
 * A translation omits `service` and `degreeCount`.
 */
export type UploadChoice =
  | { orderType: "translation" }
  | {
      orderType: "evaluation";
      service: EvaluationService;
      degreeCount: number;
      /** True when Translation is checked together with an evaluation. */
      includeTranslation: boolean;
    };

export type ServiceChecks = {
  translation: boolean;
  diploma: boolean;
  courseByCourse: boolean;
};

export function parseEvaluationService(value: string | null | undefined): EvaluationService | null {
  if (value === "diploma" || value === "course_by_course") return value;
  return null;
}

export function uploadChoiceFromSelection(
  service: EvaluationService | "translation",
  degreeCount: number,
  includeTranslation = false,
): UploadChoice {
  if (service === "translation") return { orderType: "translation" };
  return { orderType: "evaluation", service, degreeCount, includeTranslation };
}

/** Diploma and course-by-course cannot both be selected. Either may include a translation. */
export function uploadChoiceFromChecks(checks: ServiceChecks, degreeCount: number): UploadChoice | null {
  if (checks.diploma && checks.courseByCourse) return null;
  const service: EvaluationService | null = checks.diploma
    ? "diploma"
    : checks.courseByCourse
      ? "course_by_course"
      : null;
  if (!service && !checks.translation) return null;
  if (!service) return { orderType: "translation" };
  if (!Number.isInteger(degreeCount) || degreeCount < 1) return null;
  return {
    orderType: "evaluation",
    service,
    degreeCount,
    includeTranslation: checks.translation,
  };
}

export function appendOrderChoice(form: FormData, choice: UploadChoice) {
  if (choice.orderType !== "evaluation") return;
  form.set("orderType", "evaluation");
  form.set("service", choice.service);
  form.set("degreeCount", String(choice.degreeCount));
  if (choice.includeTranslation) form.set("includeTranslation", "true");
}

export function choiceFields(choice: UploadChoice): Record<string, string> {
  const form = new FormData();
  appendOrderChoice(form, choice);
  return Object.fromEntries(
    [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
