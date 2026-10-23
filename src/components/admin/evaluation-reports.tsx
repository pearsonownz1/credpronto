"use client";

import type { FormEvent } from "react";
import type { StaffEvaluationReport } from "@/lib/api/types";
import {
  evaluationPdfFileError,
  evaluationReportLabel,
  missingEvaluationReportLabels,
  reportUploadButtonLabel,
} from "@/components/admin/evaluation-report-model";

export function MissingEvaluationReports({ reports }: { reports: readonly StaffEvaluationReport[] }) {
  const missing = missingEvaluationReportLabels(reports);
  if (missing.length === 0) return null;
  return (
    <p data-testid="missing-evaluation-reports" className="text-sm text-[#b45309]">
      Still missing: {missing.join(", ")}
    </p>
  );
}

export function EvaluationReportBoxes({
  reports,
  pending,
  onReject,
  onUpload,
}: {
  reports: readonly StaffEvaluationReport[];
  pending: string | null;
  onReject: (message: string) => void;
  onUpload: (service: StaffEvaluationReport["service"], file: File) => void;
}) {
  if (reports.length === 0) return null;
  return (
    <section data-testid="evaluation-reports" aria-labelledby="evaluation-reports-heading" className="grid gap-3">
      <div>
        <h2 id="evaluation-reports-heading" className="text-lg font-semibold">
          Evaluation reports
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Upload a PDF for each purchased report. A new file replaces the one already stored.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {reports.map((report) => (
          <ReportBox
            key={report.service}
            report={report}
            pending={pending}
            onReject={onReject}
            onUpload={onUpload}
          />
        ))}
      </div>
    </section>
  );
}

function ReportBox({
  report,
  pending,
  onReject,
  onUpload,
}: {
  report: StaffEvaluationReport;
  pending: string | null;
  onReject: (message: string) => void;
  onUpload: (service: StaffEvaluationReport["service"], file: File) => void;
}) {
  const label = evaluationReportLabel(report.service);
  const busy = pending === `report-${report.service}`;
  const inputId = `evaluation-report-file-${report.service}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      onReject("Choose a PDF.");
      return;
    }
    const entry = new FormData(form).get("file");
    const file = entry instanceof File ? entry : null;
    const problem = evaluationPdfFileError(file);
    if (problem || !file) {
      onReject(problem ?? "Choose a PDF.");
      return;
    }
    onUpload(report.service, file);
    form.reset();
  }

  return (
    <article
      data-testid={`evaluation-report-${report.service}`}
      className="grid gap-3 rounded-[var(--cp-radius)] border border-line bg-white p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="mt-1 text-sm" data-testid={`evaluation-report-status-${report.service}`}>
          {report.uploaded ? "Uploaded" : "Not uploaded"}
          {report.uploaded ? <ReportFile report={report} /> : null}
        </p>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <label htmlFor={inputId} className="sr-only">
          {label} PDF
        </label>
        <input
          id={inputId}
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          disabled={pending !== null}
          data-testid={`evaluation-report-input-${report.service}`}
          className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-[var(--cp-radius)] file:border file:border-line file:bg-white file:px-2 file:py-1 file:text-sm file:font-semibold disabled:opacity-60"
        />
        <button
          type="submit"
          data-testid={`evaluation-report-upload-${report.service}`}
          disabled={pending !== null}
          className="inline-flex h-9 items-center rounded-[var(--cp-radius)] bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {reportUploadButtonLabel(report.uploaded, busy)}
        </button>
      </form>
    </article>
  );
}

function ReportFile({ report }: { report: StaffEvaluationReport }) {
  const name = report.fileName;
  if (report.url && name) {
    return (
      <>
        {" · "}
        <a
          href={report.url}
          target="_blank"
          rel="noreferrer"
          data-testid={`evaluation-report-filename-${report.service}`}
          className="font-semibold text-primary"
        >
          {name}
        </a>
      </>
    );
  }
  if (name) {
    return (
      <>
        {" · "}
        <span data-testid={`evaluation-report-filename-${report.service}`} className="font-semibold">
          {name}
        </span>
      </>
    );
  }
  if (report.url) {
    return (
      <>
        {" · "}
        <a href={report.url} target="_blank" rel="noreferrer" className="font-semibold text-primary">
          View
        </a>
      </>
    );
  }
  return null;
}
