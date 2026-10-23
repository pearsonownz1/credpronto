import { describe, expect, it } from "vitest";
import { RATE_LIMIT_MESSAGE } from "./client";
import type { PreEvaluationRecord } from "./client";
import { FAILED_PREVIEW_MESSAGE, INITIAL_PHASE, phaseForPreEvaluationLink, reducePreEvaluation } from "./phase";

const empty: PreEvaluationRecord = {
  status: "email_required",
  equivalent: null,
  confidence: null,
  previewUrl: null,
  kind: null,
};

const token = "a".repeat(43);

describe("pre-evaluation flow", () => {
  it("stays on the email gate while the status is email_required, then shows a ready preview", () => {
    let phase = reducePreEvaluation(INITIAL_PHASE, { type: "uploaded", id: "prev-1" });
    expect(phase).toMatchObject({ step: "checking", id: "prev-1", email: null });

    phase = reducePreEvaluation(phase, {
      type: "status",
      record: { ...empty, equivalent: "Bachelor's degree", confidence: "high", previewUrl: "https://cdn.example/secret.png" },
    });
    expect(phase.step).toBe("email");

    phase = reducePreEvaluation(phase, { type: "email-accepted", email: "ada@example.com" });
    expect(phase).toMatchObject({ step: "checking", email: "ada@example.com" });

    phase = reducePreEvaluation(phase, { type: "status", record: { ...empty, status: "processing" } });
    expect(phase).toMatchObject({ step: "processing", email: "ada@example.com" });

    phase = reducePreEvaluation(phase, {
      type: "status",
      record: {
        status: "ready",
        equivalent: "Bachelor's degree",
        confidence: "high",
        previewUrl: "https://cdn.example/preview.png?token=one",
        kind: "diploma",
      },
    });
    expect(phase).toMatchObject({
      step: "result",
      id: "prev-1",
      email: "ada@example.com",
      equivalent: "Bachelor's degree",
      confidence: "high",
      previewUrl: "https://cdn.example/preview.png?token=one",
    });
  });

  it("opens a result link on the server status, including a ready preview with no local email", () => {
    expect(phaseForPreEvaluationLink(" prev-1 ")).toMatchObject({
      step: "error",
      message: "Pre-evaluation not found",
      retryable: false,
    });
    let phase = phaseForPreEvaluationLink(` ${token} `);
    expect(phase).toMatchObject({ step: "checking", id: token, email: null });
    phase = reducePreEvaluation(phase, {
      type: "status",
      record: {
        status: "ready",
        equivalent: "Master's degree",
        confidence: "medium",
        previewUrl: "https://cdn.example/preview.pdf?token=one",
        kind: "transcript",
      },
    });
    expect(phase).toMatchObject({
      step: "result",
      email: null,
      equivalent: "Master's degree",
      previewUrl: "https://cdn.example/preview.pdf?token=one",
    });
  });

  it("keeps a 429 on the upload and email screens, and stops a failed document", () => {
    expect(
      reducePreEvaluation(INITIAL_PHASE, { type: "request-failed", status: 429, message: RATE_LIMIT_MESSAGE }),
    ).toMatchObject({ step: "upload", rateLimited: true, message: RATE_LIMIT_MESSAGE });

    const email = reducePreEvaluation(
      { step: "email", id: "prev-1", message: null, rateLimited: false },
      { type: "request-failed", status: 429, message: RATE_LIMIT_MESSAGE },
    );
    expect(email).toMatchObject({ step: "email", rateLimited: true, message: RATE_LIMIT_MESSAGE });

    const failed = reducePreEvaluation(
      { step: "processing", id: "prev-1", email: "ada@example.com" },
      { type: "status", record: { ...empty, status: "failed" } },
    );
    expect(failed).toMatchObject({ step: "error", retryable: false, message: FAILED_PREVIEW_MESSAGE });
  });

  it("shows the retryable error when a shown preview can no longer be refreshed", () => {
    const message = "We couldn't finish that request. Please try again.";
    const errored = reducePreEvaluation(
      {
        step: "result",
        id: "prev-1",
        email: "ada@example.com",
        equivalent: "Bachelor's degree",
        confidence: "high",
        previewUrl: "https://cdn.example/preview.pdf",
      },
      { type: "request-failed", status: 503, message },
    );
    expect(errored).toMatchObject({
      step: "error",
      id: "prev-1",
      email: "ada@example.com",
      message,
      rateLimited: false,
      retryable: true,
    });
    expect(reducePreEvaluation(errored, { type: "retry" })).toMatchObject({
      step: "checking",
      id: "prev-1",
      email: "ada@example.com",
    });
  });

  it("lets a rate-limited poll be tried again without dropping the email", () => {
    const errored = reducePreEvaluation(
      { step: "processing", id: "prev-1", email: "ada@example.com" },
      { type: "request-failed", status: 429, message: RATE_LIMIT_MESSAGE },
    );
    expect(errored).toMatchObject({ step: "error", rateLimited: true, retryable: true, email: "ada@example.com" });
    expect(reducePreEvaluation(errored, { type: "retry" })).toMatchObject({
      step: "checking",
      id: "prev-1",
      email: "ada@example.com",
    });
  });
});
