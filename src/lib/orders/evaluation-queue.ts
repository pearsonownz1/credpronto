import { evaluationQueueOrder, type EvaluationQueueOrder } from "./evaluation-review";

export type EvaluationQueueSource = {
  id: string;
  service: string | null;
  email: string | null;
  paidAt: string | null;
};

/** Paid diploma and course-by-course orders, oldest payment first. */
export function evaluationQueueRows(rows: EvaluationQueueSource[], now: number): EvaluationQueueOrder[] {
  return rows
    .flatMap((row) => {
      const queued = evaluationQueueOrder(row, now);
      return queued ? [queued] : [];
    })
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.id.localeCompare(b.id));
}
