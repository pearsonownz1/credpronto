import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: () => null,
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: () => null,
  PaymentElement: () => null,
  useElements: () => null,
  useStripe: () => null,
}));

import { IntegrationsPanel } from "./integrations-panel";

describe("integrations apps", () => {
  it("renders the Clio card without a coming-soon label before status loads", () => {
    const html = renderToStaticMarkup(createElement(IntegrationsPanel));
    const start = html.indexOf('data-testid="integration-clio"');
    const card = html.slice(start, html.indexOf("</li>", start));
    expect(start).toBeGreaterThan(-1);
    expect(card).toContain("Clio");
    expect(card).toContain(">C<");
    expect(card).toContain("Send evaluation and translation orders from a Clio matter and save finished reports back to it.");
    expect(card).toContain('data-testid="integration-clio-status"');
    expect(card).toContain("Loading…");
    expect(card).not.toContain("Coming soon");
    expect(card).not.toContain("<button");
    expect(card).not.toContain("<a ");
    expect(card.toLowerCase()).not.toContain("oauth");
  });
});
