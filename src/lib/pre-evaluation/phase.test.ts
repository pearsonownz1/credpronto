import { describe, expect, it } from "vitest";
import { RATE_LIMIT_MESSAGE } from "./client";
import type { PreEvaluationRecord } from "./client";
import { FAILED_PREVIEW_MESSAGE, INITIAL_PHASE, reducePreEvaluation } from "./phase";

const empty: PreEvaluationRecord = {
  status: "email_required",
  equivalent: null,
  confidence: null,
  previewUrl: null,
};

describe("pre-evaluation flow", () => {
  it("goes upload, email gate, then result only after the email is accepted", () => {
    let phase = reducePreEvaluation(INITIAL_PHASE, { type: "uploaded", id: "prev-1" });
    expect(phase).toMatchObject({ step: "checking", id: "prev-1", email: null });

    phase = reducePreEvaluation(phase, { type: "status", record: { ...empty, equivalent: "Bachelor's degree", confidence: "high" } });
    expect(phase.step).toBe("email");

    phase = reducePreEvaluation(phase, {
      type: "status",
      record: { status: "done", equivalent: "Bachelor's degree", confidence: "high", previewUrl: null },
    });
    expect(phase.step).toBe("email");

    phase = reducePreEvaluation(phase, { type: "email-accepted", email: "ada@example.com" });
    expect(phase).toMatchObject({ step: "checking", email: "ada@example.com" });

    phase = reducePreEvaluation(phase, { type: "status", record: { ...empty, status: "processing" } });
    expect(phase).toMatchObject({ step: "processing", email: "ada@example.com" });

    phase = reducePreEvaluation(phase, {
      type: "status",
      record: {
        status: "done",
        equivalent: "Bachelor's degree",
        confidence: "high",
        previewUrl: "https://cdn.example/preview.png",
      },
    });
    expect(phase).toMatchObject({
      step: "result",
      id: "prev-1",
      email: "ada@example.com",
      equivalent: "Bachelor's degree",
      confidence: "high",
      previewUrl: "https://cdn.example/preview.png",
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
