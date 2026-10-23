import type { StaffEvaluationReport } from "@/lib/api/types";
import { orderEvaluationKinds } from "@/lib/orders/service-selection";

export type ReportOverride = {
  fileName?: string;
  url?: string;
};

export function evaluationReportLabel(service: string): string {
  if (service === "diploma") return "Diploma evaluation";
  if (service === "course_by_course") return "Course-by-course evaluation";
  return "Evaluation report";
}

/**
 * One box per `evaluationReports` entry when that field is present.
 * Otherwise the purchased reports come from `services`, then the legacy `service` field.
 * Those fallbacks are not uploaded yet, because the payload has not said they are.
 */
export function evaluationReportsFor(input: {
  services?: readonly string[] | null;
  service?: string | null;
  evaluationReports?: readonly StaffEvaluationReport[] | null;
}): StaffEvaluationReport[] {
  if (Array.isArray(input.evaluationReports)) return normalizeReports(input.evaluationReports);
  return orderEvaluationKinds({ services: input.services, service: input.service }).map((service) => ({
    service,
    uploaded: false,
  }));
}

function normalizeReports(entries: readonly StaffEvaluationReport[]): StaffEvaluationReport[] {
  const seen = new Set<string>();
  const reports: StaffEvaluationReport[] = [];
  for (const entry of entries) {
    if (entry.service !== "diploma" && entry.service !== "course_by_course") continue;
    if (seen.has(entry.service)) continue;
    seen.add(entry.service);
    reports.push(entry);
  }
  return reports;
}

/** A successful upload in this session wins until the order payload catches up. */
export function applyReportOverrides(
  reports: readonly StaffEvaluationReport[],
  overrides: Readonly<Record<string, ReportOverride>>,
): StaffEvaluationReport[] {
  return reports.map((report) => {
    const override = overrides[report.service];
    if (!override) return report;
    const fileName = override.fileName || report.fileName;
    const url = override.url || report.url;
    return {
      ...report,
      uploaded: true,
      ...(fileName ? { fileName } : {}),
      ...(url ? { url } : {}),
    };
  });
}

export function missingEvaluationReportLabels(reports: readonly StaffEvaluationReport[]): string[] {
  return reports.filter((report) => !report.uploaded).map((report) => evaluationReportLabel(report.service));
}

export function reportUploadButtonLabel(uploaded: boolean, busy: boolean): string {
  if (busy) return "Uploading…";
  return uploaded ? "Replace PDF" : "Upload PDF";
}

export function evaluationPdfFileError(file: File | null): string | null {
  if (!file || file.name.trim() === "") return "Choose a PDF.";
  if (file.size === 0) return "Empty files are not accepted";
  const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!pdf) return "Upload a PDF";
  return null;
}

export function evaluationUploadMessage(service: string, body: unknown): string {
  const label = evaluationReportLabel(service);
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const status = typeof record.status === "string" ? record.status : "";
  const email = typeof record.email === "string" ? record.email : "";
  if (status === "received") {
    const pending = Array.isArray(record.pending)
      ? record.pending.flatMap((item) => (typeof item === "string" ? [evaluationReportLabel(item)] : []))
      : [];
    return pending.length > 0 ? `${label} saved. Still missing ${pending.join(", ")}.` : `${label} saved.`;
  }
  if (email === "failed") return `${label} saved. The customer email failed.`;
  if (email === "sent") return `${label} saved. The customer was emailed.`;
  return `${label} saved.`;
}

export function evaluationUploadStatus(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const status = (body as { status?: unknown }).status;
  return status === "delivered" || status === "approved" ? status : null;
}
