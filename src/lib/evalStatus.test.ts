import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVAL_STATUS_COLUMN,
  EVAL_STATUS_POLL_MS,
  EVAL_STATUS_TIMESTAMP_COLUMNS,
  EVAL_STATUSES,
  EVAL_STEP_DETAIL,
  EVAL_STEP_LABEL,
  customerEvalStatus,
  evalStepState,
  evaluationDownloadReady,
  evaluationStatusPollMs,
  evaluationTracker,
  readStoredEvalStatus,
  resolveEvalStatus,
  type EvalStatus,
  type EvalStepState,
} from "./evalStatus";

function states(status: EvalStatus): Record<EvalStatus, EvalStepState> {
  return Object.fromEntries(
    EVAL_STATUSES.map((step) => [step, evalStepState(status, step)]),
  ) as Record<EvalStatus, EvalStepState>;
}

describe("evaluation step states", () => {
  it("maps each status onto done, current, and upcoming", () => {
    expect(states("under_review")).toEqual({
      under_review: "current",
      performing_evaluation: "upcoming",
      performing_layout: "upcoming",
      evaluation_complete: "upcoming",
    });
    expect(states("performing_evaluation")).toEqual({
      under_review: "done",
      performing_evaluation: "current",
      performing_layout: "upcoming",
      evaluation_complete: "upcoming",
    });
    expect(states("performing_layout")).toEqual({
      under_review: "done",
      performing_evaluation: "done",
      performing_layout: "current",
      evaluation_complete: "upcoming",
    });
    expect(states("evaluation_complete")).toEqual({
      under_review: "done",
      performing_evaluation: "done",
      performing_layout: "done",
      evaluation_complete: "current",
    });
  });

  it("uses the four labels and puts the muted line on the current step only", () => {
    for (const status of EVAL_STATUSES) {
      const view = evaluationTracker({ evaluationStatus: status });
      expect(view.steps.map((step) => step.label)).toEqual([
        "Under review",
        "Performing evaluation",
        "Performing layout",
        "Evaluation complete",
      ]);
      const details = view.steps.map((step) => step.detail);
      expect(details.filter((detail) => detail != null)).toHaveLength(status === "evaluation_complete" ? 0 : 1);
      if (status !== "evaluation_complete") {
        expect(view.steps.find((step) => step.state === "current")?.detail).toBe(EVAL_STEP_DETAIL[status]);
      }
      expect(details.join(" ")).not.toMatch(/%|percent/i);
    }
    expect(EVAL_STEP_LABEL).toEqual({
      under_review: "Under review",
      performing_evaluation: "Performing evaluation",
      performing_layout: "Performing layout",
      evaluation_complete: "Evaluation complete",
    });
    expect(EVAL_STEP_DETAIL.under_review).toBe("We're checking your documents.");
    expect(EVAL_STEP_DETAIL.performing_evaluation).toBe("An evaluator is working on your evaluation.");
    expect(EVAL_STEP_DETAIL.performing_layout).toBe("We're formatting your report.");
  });

  it("falls back to under review when the status column is missing or unknown", () => {
    expect(resolveEvalStatus(undefined)).toBe("under_review");
    expect(resolveEvalStatus(null)).toBe("under_review");
    expect(resolveEvalStatus("")).toBe("under_review");
    expect(resolveEvalStatus("in_review")).toBe("under_review");
    expect(evaluationTracker({}).status).toBe("under_review");
    expect(evaluationTracker({ evaluationStatus: "layout" }).steps[0]?.state).toBe("current");
  });

  it("shows a timestamp only on a done step that has one", () => {
    const view = evaluationTracker({
      evaluationStatus: "performing_layout",
      evaluationStatusAt: {
        under_review: "2026-10-21T17:02:00.000Z",
        performing_evaluation: "not-a-time",
        performing_layout: "2026-10-21T17:24:00.000Z",
        evaluation_complete: "2026-10-21T17:31:00.000Z",
      },
    });
    expect(view.steps.map((step) => [step.status, step.timestamp])).toEqual([
      ["under_review", "2026-10-21T17:02:00.000Z"],
      ["performing_evaluation", null],
      ["performing_layout", null],
      ["evaluation_complete", null],
    ]);
  });

  it("offers the download only when the evaluation is complete", () => {
    expect(evaluationTracker({ evaluationStatus: "performing_evaluation" }).showDownload).toBe(false);
    expect(evaluationTracker({ evaluationStatus: "evaluation_complete" }).showDownload).toBe(true);
  });
});

describe("evaluation status columns", () => {
  it("reads evaluation_status and each status timestamp column", () => {
    expect(EVAL_STATUS_COLUMN).toBe("evaluation_status");
    expect(EVAL_STATUS_TIMESTAMP_COLUMNS).toEqual({
      under_review: "under_review_at",
      performing_evaluation: "performing_evaluation_at",
      performing_layout: "performing_layout_at",
      evaluation_complete: "evaluation_complete_at",
    });
    expect(
      readStoredEvalStatus({
        evaluation_status: "performing_evaluation",
        under_review_at: "2026-10-21T17:02:00.000Z",
        performing_evaluation_at: "2026-10-21T17:11:00.000Z",
      }),
    ).toEqual({
      evaluationStatus: "performing_evaluation",
      evaluationStatusAt: {
        under_review: "2026-10-21T17:02:00.000Z",
        performing_evaluation: "2026-10-21T17:11:00.000Z",
      },
    });
  });

  it("leaves the status null when the column is absent so paid orders can fall back later", () => {
    expect(readStoredEvalStatus({ status: "paid", paid_at: "2026-10-21T17:00:00.000Z" })).toEqual({
      evaluationStatus: null,
      evaluationStatusAt: {},
    });
    expect(readStoredEvalStatus({ evaluation_status: "qa", under_review_at: "" })).toEqual({
      evaluationStatus: null,
      evaluationStatusAt: {},
    });
    expect(
      customerEvalStatus({
        evaluationStatus: "performing_layout",
        evaluationStatusAt: { under_review: "2026-10-21T17:02:00.000Z", performing_layout: "soon" },
      }),
    ).toEqual({
      evaluationStatus: "performing_layout",
      evaluationStatusAt: { under_review: "2026-10-21T17:02:00.000Z" },
    });
  });
});

describe("evaluation status polling", () => {
  const evaluation = { orderType: "evaluation" as const, service: "diploma" };

  it("polls every 15 seconds until the evaluation is complete", () => {
    expect(EVAL_STATUS_POLL_MS).toBe(15_000);
    expect(evaluationStatusPollMs(evaluation, "certifying")).toBe(15_000);
    expect(
      evaluationStatusPollMs({ ...evaluation, evaluationStatus: "performing_layout" }, "certifying"),
    ).toBe(15_000);
    expect(
      evaluationStatusPollMs({ ...evaluation, evaluationStatus: "evaluation_complete" }, "certifying"),
    ).toBeNull();
    expect(evaluationStatusPollMs(evaluation, "finalizing")).toBeNull();
    expect(evaluationStatusPollMs(evaluation, "ready")).toBeNull();
    expect(evaluationStatusPollMs({ orderType: "translation", service: null }, "certifying")).toBeNull();
  });

  it("keeps the current step still when motion is reduced", () => {
    const source = readFileSync(new URL("../components/flow/evaluation-tracker.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/animate-ping/);
    expect(source).toMatch(/motion-reduce:animate-none/);
    expect(source).toMatch(/bg-\[#1F5EFF\]/);
  });

  it("treats a released report or an approved delivery as the existing download", () => {
    expect(evaluationDownloadReady({ fulfillment: "awaiting_review", delivery: { status: "pending" } })).toBe(
      false,
    );
    expect(evaluationDownloadReady({ fulfillment: "released", delivery: { status: "pending" } })).toBe(true);
    expect(
      evaluationDownloadReady({ fulfillment: "awaiting_review", delivery: { status: "approved" } }),
    ).toBe(true);
    expect(evaluationDownloadReady({ status: "delivered", delivery: null, fulfillment: null })).toBe(true);
  });
});
