import { appOrigin } from "@/lib/orders/email";
import { PENDING_EQUIVALENCY } from "@/lib/orders/equivalency";
import type { PreEvalConfidence, PreEvalStatus } from "./constants";

export type PreEvalGate = {
  email: string | null;
  status: PreEvalStatus;
  usEquivalency: string | null;
  confidence: PreEvalConfidence | null;
};

export type PreEvalPublic = {
  status: "email_required" | "processing" | "ready" | "failed";
  equivalent: string | null;
  confidence: PreEvalConfidence | null;
  previewUrl: string | null;
};

/** The suggestion stays empty until a lead email is stored. */
export function publicPreEvaluation(record: PreEvalGate, previewUrl: string | null): PreEvalPublic {
  if (!record.email) {
    return { status: "email_required", equivalent: null, confidence: null, previewUrl: null };
  }
  if (record.status !== "ready") {
    return {
      status: record.status === "failed" ? "failed" : "processing",
      equivalent: null,
      confidence: null,
      previewUrl: null,
    };
  }
  return {
    status: "ready",
    equivalent: record.usEquivalency,
    confidence: record.confidence,
    previewUrl,
  };
}

export function preEvaluationResultPath(id: string): string {
  return `/pre-evaluation/${encodeURIComponent(id)}`;
}

export function preEvaluationPreviewPath(id: string): string {
  return `/api/pre-evaluation/${encodeURIComponent(id)}/preview`;
}

export function preEvaluationOrderPath(id: string, service: "diploma" | "course_by_course"): string {
  const params = new URLSearchParams({ service, preEvaluation: id });
  return `/translate?${params.toString()}`;
}

/** Signup already reads `email` from the query string and continues to `next`. */
export function preEvaluationSignupPath(
  id: string,
  email: string,
  service: "diploma" | "course_by_course",
): string {
  const params = new URLSearchParams({
    email,
    next: preEvaluationOrderPath(id, service),
  });
  return `/sign-up?${params.toString()}`;
}

export function absoluteAppUrl(path: string, origin = appOrigin()): string {
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export type PreEvalPrefillSource = {
  email: string | null;
  status: PreEvalStatus;
  country: string | null;
  credentialName: string | null;
  usEquivalency: string | null;
  confidence: PreEvalConfidence | null;
  rationale: string | null;
  documentKind: "diploma" | "transcript" | null;
  degreeCount: number;
};

export type PreEvalPrefill = {
  email: string;
  orderType: "evaluation";
  service: "diploma" | "course_by_course";
  degreeCount: number;
  country: string | null;
  credentialName: string | null;
  equivalent: string | null;
  confidence: PreEvalConfidence | null;
  rationale: string | null;
  status: "processing" | "ready" | "failed";
  signupPath: string;
  orderPath: string;
  resultPath: string;
};

export function prefillService(kind: "diploma" | "transcript" | null): "diploma" | "course_by_course" {
  return kind === "transcript" ? "course_by_course" : "diploma";
}

/** Order and signup fields carried by the pre-evaluation id. Null until the lead email exists. */
export function orderPrefill(record: PreEvalPrefillSource, id: string): PreEvalPrefill | null {
  if (!record.email) return null;
  const ready = record.status === "ready";
  const service = prefillService(record.documentKind);
  const degreeCount = ready ? Math.min(5, Math.max(1, record.degreeCount)) : 1;
  return {
    email: record.email,
    orderType: "evaluation",
    service,
    degreeCount,
    country: ready ? record.country : null,
    credentialName: ready ? record.credentialName : null,
    equivalent: ready ? record.usEquivalency : null,
    confidence: ready ? record.confidence : null,
    rationale: ready ? record.rationale : null,
    status: record.status === "failed" ? "failed" : ready ? "ready" : "processing",
    signupPath: preEvaluationSignupPath(id, record.email, service),
    orderPath: preEvaluationOrderPath(id, service),
    resultPath: preEvaluationResultPath(id),
  };
}

export function confidenceLabel(confidence: PreEvalConfidence): string {
  if (confidence === "high") return "High";
  if (confidence === "medium") return "Medium";
  return "Low";
}

export function shownEquivalent(value: string | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || PENDING_EQUIVALENCY;
}
