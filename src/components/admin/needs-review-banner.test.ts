import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NeedsReviewBanner } from "./needs-review-banner";

const reason = "Credential evaluation is reviewed by staff.";

describe("NeedsReviewBanner", () => {
  it("renders the yellow banner while the order still needs review", () => {
    const html = renderToStaticMarkup(
      createElement(NeedsReviewBanner, { status: "paid", reviewReason: reason, deliveryStatus: "pending" }),
    );
    expect(html).toContain(`Needs review: ${reason}`);
    expect(html).toContain("bg-[#fff8ee]");
  });

  it("renders nothing for a delivered order that still has a review reason", () => {
    const html = renderToStaticMarkup(
      createElement(NeedsReviewBanner, {
        status: "delivered",
        reviewReason: reason,
        deliveryStatus: "delivered",
      }),
    );
    expect(html).toBe("");
  });
});
