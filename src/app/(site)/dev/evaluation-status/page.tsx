import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const instant = false;
import { EvaluationStatusColumn } from "@/components/flow/evaluation-tracker";
import { FlowHeader } from "@/components/flow/flow-header";
import {
  EVAL_STATUSES,
  evaluationTracker,
  type EvalStatus,
} from "@/lib/evalStatus";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Evaluation status · CredPronto",
  description: "Fixture for the paid evaluation status tracker.",
  robots: ROBOTS_NOINDEX,
};

const FIXTURE_AT: Record<EvalStatus, string> = {
  under_review: "2026-10-21T17:02:00.000Z",
  performing_evaluation: "2026-10-21T17:11:00.000Z",
  performing_layout: "2026-10-21T17:24:00.000Z",
  evaluation_complete: "2026-10-21T17:31:00.000Z",
};

/** Sample file the mock download already serves. Not a customer order. */
const FIXTURE_DOWNLOAD = "/samples/birth-certificate-en.pdf";

function doneTimestamps(status: EvalStatus): Partial<Record<EvalStatus, string>> {
  const current = EVAL_STATUSES.indexOf(status);
  const stamps: Partial<Record<EvalStatus, string>> = {};
  EVAL_STATUSES.forEach((step, index) => {
    if (index < current) stamps[step] = FIXTURE_AT[step];
  });
  return stamps;
}

export default async function EvaluationStatusFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const query = await searchParams;
  const raw = Array.isArray(query.status) ? query.status[0] : query.status;
  const known = raw != null && (EVAL_STATUSES as readonly string[]).includes(raw);
  if (raw != null && !known) notFound();
  const statuses: EvalStatus[] = known ? [raw as EvalStatus] : [...EVAL_STATUSES];

  return (
    <div>
      {statuses.map((status) => {
        const complete = status === "evaluation_complete";
        const view = evaluationTracker({
          evaluationStatus: status,
          evaluationStatusAt: doneTimestamps(status),
        });
        return (
          <section key={status} data-testid={`eval-fixture-${status}`}>
            <FlowHeader current={complete ? "download" : "review"} track="evaluation" />
            <main className="mx-auto w-full max-w-[640px] px-4 pt-10 pb-16 md:pt-16">
              <EvaluationStatusColumn
                orderId="CP-24817"
                view={view}
                phase={complete ? "ready" : "review"}
                downloadHref={complete ? FIXTURE_DOWNLOAD : null}
              />
            </main>
          </section>
        );
      })}
    </div>
  );
}
