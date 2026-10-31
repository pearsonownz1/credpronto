import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SavedMethodSummary } from "./saved-method";

describe("saved method display", () => {
  it("shows Link with the account email and no expiry when the card is unknown", () => {
    const html = renderToStaticMarkup(
      createElement(SavedMethodSummary, {
        method: { brand: "link", last4: "link", expMonth: null, expYear: null, email: "guy@gcs.org", wallet: "link" },
      }),
    );
    expect(html).toContain("Link · guy@gcs.org");
    expect(html).toContain("#00D66F");
    expect(html).not.toContain("Expiry");
    expect(html).not.toContain("saved-method-card");
  });

  it("shows the underlying card and omits expiry when it is unknown", () => {
    const html = renderToStaticMarkup(
      createElement(SavedMethodSummary, {
        method: { brand: "visa", last4: "6850", expMonth: null, expYear: null, email: "guy@gcs.org", wallet: "link" },
      }),
    );
    expect(html).toContain("Link · guy@gcs.org");
    expect(html).toContain("Visa •••• 6850");
    expect(html).not.toContain("Expiry");
  });

  it("shows expiry only when Stripe returned it", () => {
    const html = renderToStaticMarkup(
      createElement(SavedMethodSummary, {
        method: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2028, email: null, wallet: null },
      }),
    );
    expect(html).toContain("Visa •••• 4242");
    expect(html).toContain("Expires 04/28");
    expect(html).not.toContain("Link");
  });
});
