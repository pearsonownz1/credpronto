import { describe, expect, it } from "vitest";
import {
  EVALUATION_QUEUE_UNAVAILABLE,
  EVALUATION_UPLOAD_UNAVAILABLE,
  evaluationQueueUnavailable,
  evaluationUploadError,
} from "./evaluation-staff";

describe("evaluation staff endpoints", () => {
  it("treats a missing queue route as unavailable and leaves other failures alone", () => {
    expect(evaluationQueueUnavailable(404)).toBe(true);
    expect(evaluationQueueUnavailable(500)).toBe(false);
    expect(evaluationQueueUnavailable(401)).toBe(false);
    expect(EVALUATION_QUEUE_UNAVAILABLE).toContain("isn't available yet");
  });

  it("keeps a missing order distinct from a missing upload route", () => {
    expect(evaluationUploadError(404, "Request failed")).toBe(EVALUATION_UPLOAD_UNAVAILABLE);
    expect(evaluationUploadError(404, "Not found")).toBe(EVALUATION_UPLOAD_UNAVAILABLE);
    expect(evaluationUploadError(404, "Order not found")).toBe("Order not found");
    expect(evaluationUploadError(415, "Upload a PDF")).toBe("Upload a PDF");
    expect(evaluationUploadError(409, "This order is not paid")).toBe("This order is not paid");
  });
});
