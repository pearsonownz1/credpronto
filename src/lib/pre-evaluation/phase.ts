import { isOrderToken } from "@/lib/orders/token";
import type { PreEvaluationFileKind, PreEvaluationRecord } from "./client";

export const FAILED_PREVIEW_MESSAGE = "We couldn't prepare a preview from this document. Try a clearer photo or a PDF.";

export const INCOMPLETE_PREVIEW_MESSAGE = "We couldn't read a U.S. equivalent from this document.";

export type PreEvaluationPhase =
  | { step: "upload"; message: string | null; rateLimited: boolean }
  | { step: "checking"; id: string; email: string | null }
  | { step: "processing"; id: string; email: string | null }
  | { step: "email"; id: string; message: string | null; rateLimited: boolean }
  | {
      step: "result";
      id: string;
      email: string | null;
      equivalent: string;
      confidence: NonNullable<PreEvaluationRecord["confidence"]>;
      previewUrl: string | null;
      documentKind: PreEvaluationFileKind | null;
    }
  | {
      step: "error";
      id: string | null;
      email: string | null;
      message: string;
      rateLimited: boolean;
      retryable: boolean;
    };

export const INITIAL_PHASE: PreEvaluationPhase = { step: "upload", message: null, rateLimited: false };

/** Resume `/pre-evaluation/{id}` from the result link. A bad token never calls the API. */
export function phaseForPreEvaluationLink(id: string | null | undefined): PreEvaluationPhase {
  const trimmed = id?.trim() ?? "";
  if (!trimmed) return INITIAL_PHASE;
  if (!isOrderToken(trimmed)) {
    return {
      step: "error",
      id: null,
      email: null,
      message: "Pre-evaluation not found",
      rateLimited: false,
      retryable: false,
    };
  }
  return { step: "checking", id: trimmed, email: null };
}

export type PreEvaluationEvent =
  | { type: "reset" }
  | { type: "file-rejected"; message: string }
  | { type: "uploaded"; id: string }
  | { type: "status"; record: PreEvaluationRecord }
  | { type: "request-failed"; status: number; message: string }
  | { type: "email-rejected"; message: string }
  | { type: "email-accepted"; email: string }
  | { type: "retry" };

export function reducePreEvaluation(phase: PreEvaluationPhase, event: PreEvaluationEvent): PreEvaluationPhase {
  switch (event.type) {
    case "reset":
      return INITIAL_PHASE;
    case "file-rejected":
      if (phase.step !== "upload") return phase;
      return { step: "upload", message: event.message, rateLimited: false };
    case "uploaded": {
      const id = event.id.trim();
      if (!id) return { step: "upload", message: "The preview did not start.", rateLimited: false };
      return { step: "checking", id, email: null };
    }
    case "email-rejected":
      if (phase.step !== "email") return phase;
      return { ...phase, message: event.message, rateLimited: false };
    case "email-accepted":
      if (phase.step !== "email") return phase;
      return { step: "checking", id: phase.id, email: event.email.trim() };
    case "retry":
      if (phase.step === "error" && phase.retryable && phase.id) {
        return { step: "checking", id: phase.id, email: phase.email };
      }
      return INITIAL_PHASE;
    case "request-failed":
      return fail(phase, event.status, event.message);
    case "status":
      return applyStatus(phase, event.record);
    default:
      return phase;
  }
}

function knownId(phase: PreEvaluationPhase): string | null {
  return phase.step === "upload" ? null : phase.id;
}

function knownEmail(phase: PreEvaluationPhase): string | null {
  if (phase.step === "checking" || phase.step === "processing" || phase.step === "result" || phase.step === "error") {
    return phase.email;
  }
  return null;
}

function fail(phase: PreEvaluationPhase, status: number, message: string): PreEvaluationPhase {
  const rateLimited = status === 429;
  if (phase.step === "upload") return { step: "upload", message, rateLimited };
  if (phase.step === "email") return { step: "email", id: phase.id, message, rateLimited };
  return {
    step: "error",
    id: knownId(phase),
    email: knownEmail(phase),
    message,
    rateLimited,
    retryable: knownId(phase) != null,
  };
}

function applyStatus(phase: PreEvaluationPhase, record: PreEvaluationRecord): PreEvaluationPhase {
  const id = knownId(phase);
  if (!id) return phase;
  const email = knownEmail(phase);

  if (record.status === "email_required") {
    if (phase.step === "email") return phase;
    return { step: "email", id, message: null, rateLimited: false };
  }

  if (record.status === "processing") {
    if (phase.step === "processing" && phase.id === id && phase.email === email) return phase;
    return { step: "processing", id, email };
  }

  if (record.status === "failed") {
    return {
      step: "error",
      id,
      email,
      message: FAILED_PREVIEW_MESSAGE,
      rateLimited: false,
      retryable: false,
    };
  }

  if (!record.equivalent || !record.confidence) {
    return {
      step: "error",
      id,
      email,
      message: INCOMPLETE_PREVIEW_MESSAGE,
      rateLimited: false,
      retryable: true,
    };
  }

  return {
    step: "result",
    id,
    email,
    equivalent: record.equivalent,
    confidence: record.confidence,
    previewUrl: record.previewUrl,
    documentKind: record.documentKind ?? null,
  };
}
