import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AddonPanelState } from "./addon-panel";
import { OrderRail } from "./preview-chrome";
import { CERTIFICATE_PREVIEW, type PreviewOrder } from "./preview-order";

function panel(totalCents: number): AddonPanelState {
  return {
    options: [
      { id: "notarization", label: "Notarization", unitCents: 1795, per: "order", totalCents: 1795 },
      { id: "mail", label: "USPS Priority hard copy", unitCents: 1295, per: "order", totalCents: 1295 },
    ],
    selected: [],
    address: { name: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" },
    error: null,
    pending: false,
    totalCents,
    toggle: () => undefined,
    setField: () => undefined,
    purchase: () => undefined,
  };
}

describe("evaluation review price summary", () => {
  it("shows the diploma fee, add-ons, total, and pay button without credential rows", () => {
    const order: PreviewOrder = {
      ...CERTIFICATE_PREVIEW,
      product: "evaluation",
      pricing: {
        perPageCents: 1995,
        pages: 1,
        certificationIncluded: true,
        totalCents: 1995,
        lines: [{ label: "Diploma evaluation", amountCents: 1995 }],
      },
      evaluationDetails: [
        { label: "Credential holder", value: "Ada Lovelace" },
        { label: "School", value: "Example University" },
        { label: "Degree", value: "Licence" },
        { label: "Dates", value: "2018–2022" },
        { label: "U.S. equivalency", value: "Bachelor's degree" },
      ],
    };
    const html = renderToStaticMarkup(createElement(OrderRail, { order, corrections: [], panel: panel(1995) }));
    expect(html).toContain("Diploma evaluation");
    expect(html).toContain("$19.95");
    expect(html).toContain("Notarization");
    expect(html).toContain("USPS Priority hard copy");
    expect(html).toContain("Total");
    expect(html).toContain("Pay $19.95");
    expect(html).not.toContain("Credential holder");
    expect(html).not.toContain("Example University");
    expect(html).not.toContain("Licence");
    expect(html).not.toContain("2018–2022");
    expect(html).not.toContain("U.S. equivalency");
    expect(html).not.toContain('data-testid="evaluation-detail"');
  });
});
