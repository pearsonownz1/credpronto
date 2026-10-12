import type { QaIssueType, QaReport, QaStatus } from "@/lib/api/types";

const STATUS_LABEL: Record<QaStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  retranslated: "Retranslated",
};

const STATUS_CLASS: Record<QaStatus, string> = {
  pass: "bg-[#e8f6f0] text-[var(--cp-ok)]",
  fail: "bg-[#fdecec] text-[#9b1c1c]",
  retranslated: "bg-[#fff8ee] text-[#92400e]",
};

const TYPE_LABEL: Record<QaIssueType, string> = {
  name: "Name",
  date: "Date",
  number: "Number",
  missing_text: "Missing text",
  layout: "Layout",
};

export function QaPanel({
  qa,
  onJump,
}: {
  qa: QaReport;
  onJump: (page: number) => void;
}) {
  return (
    <section data-testid="qa-check" className="rounded-[var(--cp-radius)] border border-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">QA check</h2>
        <span
          data-testid="qa-status"
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[qa.status]}`}
        >
          {STATUS_LABEL[qa.status]}
        </span>
        <p className="text-sm text-ink-muted">
          Score <span data-testid="qa-score" className="font-semibold text-ink">{formatScore(qa.score)}</span>
          {" · "}
          Attempts <span data-testid="qa-attempts" className="font-semibold text-ink">{qa.attempts}</span>
        </p>
      </div>
      {qa.issues.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No issues.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Severity</th>
                <th className="py-2 pr-3 font-medium">Page</th>
                <th className="py-2 pr-3 font-medium">Original</th>
                <th className="py-2 pr-3 font-medium">Translated</th>
                <th className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {qa.issues.map((issue, index) => (
                <tr key={`${issue.type}-${issue.page}-${index}`} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-3">{TYPE_LABEL[issue.type]}</td>
                  <td className="py-2 pr-3">{issue.severity}</td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      data-testid={`qa-issue-${index}`}
                      onClick={() => onJump(issue.page)}
                      className="font-semibold text-primary"
                    >
                      Page {issue.page}
                    </button>
                  </td>
                  <td className="py-2 pr-3">{issue.original || "—"}</td>
                  <td className="py-2 pr-3">{issue.translated || "—"}</td>
                  <td className="py-2">{issue.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(2);
}
