import { MAX_DEGREE_COUNT } from "@/lib/orders/evaluation-price";
import type { CatalogService } from "@/lib/orders/service-selection";
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
      /** Null when both diploma and course-by-course are selected. */
      service: EvaluationService | null;
      degreeCount: number;
      /** True when Translation is checked together with an evaluation. */
      includeTranslation: boolean;
      /** Every checked service. Omitted by the older single-service helper. */
      services?: CatalogService[];
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

/** Any combination of the three services. An evaluation still needs a degree count. */
export function uploadChoiceFromChecks(checks: ServiceChecks, degreeCount: number): UploadChoice | null {
  const services: CatalogService[] = [];
  if (checks.translation) services.push("translation");
  if (checks.diploma) services.push("diploma");
  if (checks.courseByCourse) services.push("course_by_course");
  if (services.length === 0) return null;
  const evaluation = checks.diploma || checks.courseByCourse;
  if (!evaluation) return { orderType: "translation" };
  if (!Number.isInteger(degreeCount) || degreeCount < 1 || degreeCount > MAX_DEGREE_COUNT) return null;
  const service: EvaluationService | null =
    checks.diploma && checks.courseByCourse ? null : checks.diploma ? "diploma" : "course_by_course";
  return {
    orderType: "evaluation",
    service,
    degreeCount,
    includeTranslation: checks.translation,
    services,
  };
}

export function appendOrderChoice(form: FormData, choice: UploadChoice) {
  if (choice.orderType !== "evaluation") return;
  form.set("orderType", "evaluation");
  if (choice.service) form.set("service", choice.service);
  form.set("degreeCount", String(choice.degreeCount));
  if (choice.includeTranslation) form.set("includeTranslation", "true");
  if (choice.services && choice.services.length > 0) form.set("services", choice.services.join(","));
}

export function choiceFields(choice: UploadChoice): Record<string, string> {
  const form = new FormData();
  appendOrderChoice(form, choice);
  return Object.fromEntries(
    [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
