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
    };

export function parseEvaluationService(value: string | null | undefined): EvaluationService | null {
  if (value === "diploma" || value === "course_by_course") return value;
  return null;
}

export function uploadChoiceFromSelection(
  service: EvaluationService | "translation",
  degreeCount: number,
): UploadChoice {
  if (service === "translation") return { orderType: "translation" };
  return { orderType: "evaluation", service, degreeCount };
}

/** Evaluation uploads stay off until this is `1`. Translation uploads are unchanged. */
export function evaluationsLive(): boolean {
  return process.env.NEXT_PUBLIC_EVALUATIONS_LIVE === "1";
}

export function appendOrderChoice(form: FormData, choice: UploadChoice) {
  if (choice.orderType !== "evaluation") return;
  form.set("orderType", "evaluation");
  form.set("service", choice.service);
  form.set("degreeCount", String(choice.degreeCount));
}

export function choiceFields(choice: UploadChoice): Record<string, string> {
  const form = new FormData();
  appendOrderChoice(form, choice);
  return Object.fromEntries(
    [...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
