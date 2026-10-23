"use client";

import { useEffect, useReducer, useState } from "react";
import { customerEmailError } from "@/lib/flow/customer-email";
import {
  PRE_EVALUATION_POLL_MS,
  createPreEvaluation,
  getPreEvaluation,
  preEvaluationErrorStatus,
  submitPreEvaluationEmail,
} from "@/lib/pre-evaluation/client";
import { preEvaluationFileError } from "@/lib/pre-evaluation/file";
import { phaseForPreEvaluationLink, reducePreEvaluation } from "@/lib/pre-evaluation/phase";
import { preEvaluationProgress } from "@/lib/pre-evaluation/progress";
import {
  PreEvaluationChecking,
  PreEvaluationEmailGate,
  PreEvaluationError,
  PreEvaluationProcessing,
  PreEvaluationResult,
  PreEvaluationUpload,
} from "./screens";

export function PreEvaluationExperience({ initialId = null }: { initialId?: string | null }) {
  const [phase, dispatch] = useReducer(reducePreEvaluation, initialId, phaseForPreEvaluationLink);
  const [elapsed, setElapsed] = useState(0);
  const [uploadPending, setUploadPending] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const polling = phase.step === "checking" || phase.step === "processing";
  const pollId = polling ? phase.id : null;
  const pollEmail = polling ? phase.email : null;

  useEffect(() => {
    if (phase.step !== "processing") return;
    const started = Date.now();
    const tick = () => setElapsed(Date.now() - started);
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [phase.step, pollId]);

  useEffect(() => {
    if (!pollId) return;
    const id = pollId;
    let cancelled = false;

    async function poll() {
      try {
        const record = await getPreEvaluation(id);
        if (!cancelled) dispatch({ type: "status", record });
      } catch (cause) {
        if (cancelled) return;
        const error = preEvaluationErrorStatus(cause);
        dispatch({ type: "request-failed", status: error.status, message: error.message });
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), PRE_EVALUATION_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollId, pollEmail]);

  async function submitFile(file: File) {
    const problem = preEvaluationFileError(file);
    if (problem) {
      dispatch({ type: "file-rejected", message: problem });
      return;
    }
    setUploadPending(true);
    try {
      const created = await createPreEvaluation(file);
      dispatch({ type: "uploaded", id: created.id });
    } catch (cause) {
      const error = preEvaluationErrorStatus(cause);
      dispatch({ type: "request-failed", status: error.status, message: error.message });
    } finally {
      setUploadPending(false);
    }
  }

  async function submitEmail(email: string) {
    if (phase.step !== "email") return;
    const problem = customerEmailError(email);
    if (problem) {
      dispatch({ type: "email-rejected", message: problem });
      return;
    }
    setEmailPending(true);
    try {
      await submitPreEvaluationEmail(phase.id, email.trim());
      dispatch({ type: "email-accepted", email: email.trim() });
    } catch (cause) {
      const error = preEvaluationErrorStatus(cause);
      dispatch({ type: "request-failed", status: error.status, message: error.message });
    } finally {
      setEmailPending(false);
    }
  }

  return (
    <main data-testid="pre-evaluation">
      {phase.step === "upload" ? (
        <PreEvaluationUpload
          message={phase.message}
          rateLimited={phase.rateLimited}
          pending={uploadPending}
          onSubmit={(file) => void submitFile(file)}
        />
      ) : null}
      {phase.step === "checking" ? <PreEvaluationChecking /> : null}
      {phase.step === "processing" ? <PreEvaluationProcessing progress={preEvaluationProgress(elapsed)} /> : null}
      {phase.step === "email" ? (
        <PreEvaluationEmailGate
          message={phase.message}
          rateLimited={phase.rateLimited}
          pending={emailPending}
          onSubmit={(email) => void submitEmail(email)}
        />
      ) : null}
      {phase.step === "result" ? (
        <PreEvaluationResult
          id={phase.id}
          equivalent={phase.equivalent}
          confidence={phase.confidence}
          previewUrl={phase.previewUrl}
          onPreviewRefreshFailed={(error) =>
            dispatch({ type: "request-failed", status: error.status, message: error.message })
          }
        />
      ) : null}
      {phase.step === "error" ? (
        <PreEvaluationError
          message={phase.message}
          rateLimited={phase.rateLimited}
          retryable={phase.retryable}
          onRetry={() => dispatch({ type: "retry" })}
          onReset={() => dispatch({ type: "reset" })}
        />
      ) : null}
    </main>
  );
}
