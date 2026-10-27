import { describe, expect, it } from "vitest";
import { humanReviewReason, IMAGE_QUALITY_MESSAGE, staffNeedsReviewBanner } from "./review-reason";

describe("humanReviewReason", () => {
  it("turns database errors into staff-facing sentences", () => {
    expect(
      humanReviewReason(
        'duplicate key value violates unique constraint "order_qa_runs_order_attempt_key"',
      ),
    ).toBe("Quality check was already recorded for this attempt.");
    expect(humanReviewReason('null value in column "skip_reason" of relation "document_pages" violates not-null constraint')).toBe(
      "Page skip could not be saved. The skip reason field is missing.",
    );
    expect(humanReviewReason('duplicate key value violates unique constraint "orders_pkey"')).toBe(
      "A duplicate record blocked this step.",
    );
    expect(humanReviewReason('column "review_reason" of relation "orders" does not exist')).toBe(
      "A database update failed. The order needs another look.",
    );
  });

  it("keeps known review reasons and drops blanks", () => {
    expect(humanReviewReason("translation_timeout")).toBe("Translation timed out before it could finish.");
    expect(humanReviewReason("QA found issues that were not fixed after 2 retranslations.")).toBe(
      "QA found issues that were not fixed after 2 retranslations.",
    );
    expect(humanReviewReason("image_quality")).toBe(IMAGE_QUALITY_MESSAGE);
    expect(humanReviewReason("image_quality")).toBe(
      "This photo looks blurry, dark, or cropped. Please upload a clearer photo or scan.",
    );
    expect(humanReviewReason("  ")).toBeNull();
    expect(humanReviewReason(null)).toBeNull();
  });
});

describe("staffNeedsReviewBanner", () => {
  const reason = "Credential evaluation is reviewed by staff.";

  it("shows the reason until the order is delivered", () => {
    expect(staffNeedsReviewBanner({ status: "paid", reviewReason: reason, deliveryStatus: "pending" })).toBe(reason);
    expect(staffNeedsReviewBanner({ status: "approved", reviewReason: reason, deliveryStatus: "approved" })).toBe(
      reason,
    );
    expect(staffNeedsReviewBanner({ status: "paid", reviewReason: null })).toBeNull();
  });

  it("explains an image quality hold instead of showing the slug", () => {
    expect(staffNeedsReviewBanner({ status: "needs_review", reviewReason: "image_quality" })).toBe(
      IMAGE_QUALITY_MESSAGE,
    );
  });

  it("hides a leftover review reason once the order or its delivery is delivered", () => {
    expect(staffNeedsReviewBanner({ status: "delivered", reviewReason: reason, deliveryStatus: "delivered" })).toBeNull();
    expect(staffNeedsReviewBanner({ status: "delivered", reviewReason: reason, deliveryStatus: null })).toBeNull();
    expect(staffNeedsReviewBanner({ status: "approved", reviewReason: reason, deliveryStatus: "delivered" })).toBeNull();
  });
});
