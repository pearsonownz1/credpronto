import { MAX_DEGREE_COUNT } from "@/lib/orders/evaluation-price";
import type { EvaluationService } from "@/lib/orders/types";

/**
 * Customer upload fields from docs/api.md.
 * `service` is the evaluation kind (`diploma` or `course_by_course`).
 * A translation omits `service` and `degreeCount`.
 */
export type UploadChoice =
  | { orderType: "translation"; services?: string[] }
  | {
      orderType: "evaluation";
      service: EvaluationService;
      degreeCount: number;
      /** True when Translation is checked together with an evaluation. */
      includeTranslation: boolean;
      services?: string[];
    };

/** Ids already used by the upload checkboxes and the order request. */
export const SERVICE_IDS = {
  translation: "translation",
  diploma: "diploma",
  courseByCourse: "course_by_course",
} as const;

export type ServiceChecks = {
  translation: boolean;
  diploma: boolean;
  courseByCourse: boolean;
};

export function parseEvaluationService(value: string | null | undefined): EvaluationService | null {
  if (value === "diploma" || value === "course_by_course") return value;
  return null;
}

/** Checked services, in the same order as the upload page. */
export function checkedServiceIds(checks: ServiceChecks): string[] {
  const ids: string[] = [];
  if (checks.translation) ids.push(SERVICE_IDS.translation);
  if (checks.diploma) ids.push(SERVICE_IDS.diploma);
  if (checks.courseByCourse) ids.push(SERVICE_IDS.courseByCourse);
  return ids;
}

export function uploadChoiceFromSelection(
  service: EvaluationService | "translation",
  degreeCount: number,
  includeTranslation = false,
): UploadChoice {
  if (service === "translation") return { orderType: "translation", services: [SERVICE_IDS.translation] };
  return {
    orderType: "evaluation",
    service,
    degreeCount,
    includeTranslation,
    services: includeTranslation ? [SERVICE_IDS.translation, service] : [service],
  };
}

/**
 * Any non-empty mix of the three services.
 * `service` stays a single evaluation id so the older request shape still parses.
 * When both evaluations are checked, that fallback id is `diploma`.
 */
export function uploadChoiceFromChecks(checks: ServiceChecks, degreeCount: number): UploadChoice | null {
  const services = checkedServiceIds(checks);
  if (services.length === 0) return null;
  const service: EvaluationService | null = checks.diploma
    ? "diploma"
    : checks.courseByCourse
      ? "course_by_course"
      : null;
  if (!service) return { orderType: "translation", services };
  if (!Number.isInteger(degreeCount) || degreeCount < 1 || degreeCount > MAX_DEGREE_COUNT) return null;
  return {
    orderType: "evaluation",
    service,
    degreeCount,
    includeTranslation: checks.translation,
    services,
  };
}

/** `services` lists every checked id. `service` and `includeTranslation` stay for older servers. */
export function servicesForChoice(choice: UploadChoice): string[] {
  if (choice.services && choice.services.length > 0) return [...choice.services];
  if (choice.orderType !== "evaluation") return [SERVICE_IDS.translation];
  return choice.includeTranslation ? [SERVICE_IDS.translation, choice.service] : [choice.service];
}

export function orderRequestChoice(choice: UploadChoice): Record<string, unknown> {
  const fields = choiceFields(choice);
  return {
    orderType: choice.orderType,
    ...fields,
    ...(choice.orderType === "evaluation" ? { includeTranslation: choice.includeTranslation } : {}),
    services: servicesForChoice(choice),
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
