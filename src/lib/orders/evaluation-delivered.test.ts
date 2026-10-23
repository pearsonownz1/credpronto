import { describe, expect, it } from "vitest";
import { deliveredEvaluationPatch } from "./evaluation-delivered";

const at = "2026-10-23T14:00:00.000Z";

describe("deliveredEvaluationPatch", () => {
  it("marks an under-review evaluation complete on delivery", () => {
    expect(
      deliveredEvaluationPatch({ service: "course_by_course", serviceType: "evaluation", evaluationStatus: "under_review" } as never, at),
    ).toEqual({
      evaluation_status: "evaluation_complete",
      evaluation_complete_at: at,
      review_reason: null,
    });
  });

  it("marks a never-staged evaluation complete", () => {
    expect(deliveredEvaluationPatch({ service: "diploma", evaluationStatus: null } as never, at)).toEqual({
      evaluation_status: "evaluation_complete",
      evaluation_complete_at: at,
      review_reason: null,
    });
  });

  it("clears the review flag without restamping an already-complete evaluation or a translation", () => {
    expect(deliveredEvaluationPatch({ service: "diploma", evaluationStatus: "evaluation_complete" } as never, at)).toEqual({
      review_reason: null,
    });
    expect(deliveredEvaluationPatch({ service: null, serviceType: "translation", evaluationStatus: null } as never, at)).toEqual({
      review_reason: null,
    });
  });
});
