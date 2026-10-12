import { DIPLOMA_SAMPLE } from "@/lib/evaluations/sample";
import { ReportFacts, ReportPage, ReportSignature, ReportTop } from "./report-chrome";

export function DiplomaSample() {
  const sample = DIPLOMA_SAMPLE;
  return (
    <ReportPage>
      <ReportTop reportId={sample.reportId} kind={sample.kind} issued={sample.issued} />
      <h2 className="mt-[22px] mb-1 text-[22px] font-bold tracking-[-0.4px]">{sample.title}</h2>
      <p className="mb-[18px] text-ink-muted">
        Prepared for {sample.preparedFor} · Purpose: {sample.purpose}
      </p>
      <div className="mb-4 rounded-[var(--cp-radius)] border border-[#c9d6ff] bg-[var(--cp-blue-l)] px-[18px] py-4">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-primary uppercase">
          U.S. equivalency
        </p>
        <p className="mt-1 text-[18px] leading-snug font-bold tracking-[-0.3px]">
          {sample.equivalency}
        </p>
      </div>
      <ReportFacts title="Applicant" rows={sample.applicant} />
      <ReportFacts title="Credential" rows={sample.credential} />
      <ReportFacts title="Documents reviewed" rows={sample.documents} />
      <p className="text-[11px] leading-relaxed text-ink-muted">{sample.advisory}</p>
      <ReportSignature reportId={sample.reportId} page={sample.page} />
    </ReportPage>
  );
}
