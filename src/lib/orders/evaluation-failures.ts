import type { EvaluationService } from "./types";

export type StoredEvaluationFailure = {
  service: EvaluationService;
  reason: string;
};

function sameFailures(left: readonly StoredEvaluationFailure[], right: readonly StoredEvaluationFailure[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.service === right[index]?.service && item.reason === right[index]?.reason);
}

/**
 * Progress object with the latest evaluation failures.
 * An empty list removes a reason that was stored earlier.
 * Returns null when the stored list is already the same.
 */
export function progressWithEvaluationFailures<T extends { evaluationFailures?: StoredEvaluationFailure[] }>(
  progress: T,
  failures: readonly StoredEvaluationFailure[],
): T | null {
  const next = parseEvaluationFailures(failures);
  const previous = parseEvaluationFailures(progress.evaluationFailures);
  if (sameFailures(previous, next)) return null;
  const rest = { ...progress };
  delete rest.evaluationFailures;
  if (next.length === 0) return rest;
  return { ...rest, evaluationFailures: next };
}

export function parseEvaluationFailures(value: unknown): StoredEvaluationFailure[] {
  if (!Array.isArray(value)) return [];
  const failures: StoredEvaluationFailure[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { service?: unknown; reason?: unknown };
    const service = item.service === "diploma" || item.service === "course_by_course" ? item.service : null;
    const reason = typeof item.reason === "string" ? item.reason.trim() : "";
    if (!service || !reason) continue;
    failures.push({ service, reason });
  }
  return failures;
}
