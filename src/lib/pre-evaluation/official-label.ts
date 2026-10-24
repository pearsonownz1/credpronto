import { COURSE_BY_COURSE_CENTS, DIPLOMA_EVALUATION_CENTS } from "@/lib/evaluations/catalog";
import { formatMoney } from "@/lib/flow/pricing";
import type { PreEvaluationFileKind } from "./client";

/** Transcripts use the course-by-course fee. A diploma uses the diploma fee. Unknown kind stays unlabeled. */
export function officialEvaluationButtonLabel(kind: PreEvaluationFileKind | null): string {
  const cents = kind === "transcript" ? COURSE_BY_COURSE_CENTS : kind === "diploma" ? DIPLOMA_EVALUATION_CENTS : null;
  if (cents == null) return "Get my official evaluation";
  return `Get my official evaluation · ${formatMoney(cents)}`;
}
