"use client";

import type { EvaluationSummary } from "@/lib/orders/evaluation-summary";
import { evaluationReportLabel } from "@/components/admin/evaluation-report-model";

export function EvaluationSummaries({
  reports,
  summaries,
  problems,
  canGenerate,
  pending,
  onGenerate,
}: {
  reports: readonly { service: "diploma" | "course_by_course"; url?: string }[];
  summaries: readonly EvaluationSummary[];
  problems?: readonly { service: "diploma" | "course_by_course"; reason: string }[];
  canGenerate: boolean;
  pending: string | null;
  onGenerate: () => void;
}) {
  if (reports.length === 0) return null;
  const byService = new Map(summaries.map((summary) => [summary.service, summary]));
  const reasonsFor = (service: "diploma" | "course_by_course") =>
    (problems ?? []).filter((problem) => problem.service === service).map((problem) => problem.reason);
  const busy = pending === "regenerate-evaluations";

  return (
    <section data-testid="evaluation-summaries" aria-labelledby="evaluation-summaries-heading" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="evaluation-summaries-heading" className="text-lg font-semibold">
            Evaluations
          </h2>
          <p className="mt-1 text-sm text-ink-muted">Each purchased evaluation is listed here, beside the translation.</p>
        </div>
        {canGenerate ? (
          <button
            type="button"
            data-testid="regenerate-evaluations"
            disabled={pending !== null}
            onClick={onGenerate}
            className="inline-flex h-9 items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? "Generating…" : "Generate missing evaluations"}
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {reports.map((report) => {
          const summary = byService.get(report.service);
          const reasons = reasonsFor(report.service);
          return (
            <article
              key={report.service}
              data-testid={`evaluation-summary-${report.service}`}
              className="grid gap-2 rounded-[var(--cp-radius)] border border-line bg-white p-4"
            >
              <h3 className="text-sm font-semibold">{summary?.heading ?? evaluationReportLabel(report.service)}</h3>
              {summary ? (
                <ul className="grid gap-1 text-sm">
                  {summary.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">Not generated yet.</p>
              )}
              {reasons.length > 0 ? (
                <div data-testid={`evaluation-problem-${report.service}`} className="grid gap-1">
                  {reasons.map((reason, index) => (
                    <p key={`${reason}-${index}`} className="text-sm text-[#b45309]">
                      {reason}
                    </p>
                  ))}
                </div>
              ) : null}
              {report.url ? (
                <a
                  href={report.url}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`evaluation-pdf-${report.service}`}
                  className="text-sm font-semibold text-primary"
                >
                  Open PDF
                </a>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
