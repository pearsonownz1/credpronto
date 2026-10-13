import { Suspense } from "react";
import { EvaluationQueue } from "@/components/admin/evaluation-queue";
import { evaluationQueueUnavailable } from "@/lib/api/evaluation-staff";
import { listEvaluationQueue } from "@/lib/api/server";

export const instant = false;

export default function EvaluationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading evaluations…</p>}>
      <EvaluationList />
    </Suspense>
  );
}

async function EvaluationList() {
  const result = await listEvaluationQueue();
  if (!result.ok) {
    if (evaluationQueueUnavailable(result.status)) {
      return <EvaluationQueue orders={[]} unavailable />;
    }
    return (
      <p role="alert" className="text-sm text-[#b45309]">
        {result.error}
      </p>
    );
  }
  return <EvaluationQueue orders={result.data.orders} />;
}
