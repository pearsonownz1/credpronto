import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addonOptions } from "@/lib/orders/addons";
import { AddonPanel, checkoutPayload, useAddonPanel, type AddonPanelState } from "./addon-panel";
import { CERTIFICATE_PREVIEW, type PreviewOrder } from "./preview-order";

function panel(patch: Partial<AddonPanelState> & Pick<AddonPanelState, "options" | "selected" | "totalCents">): AddonPanelState {
  return {
    address: { name: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" },
    error: null,
    pending: false,
    toggle: () => undefined,
    setField: () => undefined,
    purchase: () => undefined,
    ...patch,
  };
}

function Hooked({ order }: { order: PreviewOrder }) {
  const state = useAddonPanel(order);
  return createElement(AddonPanel, { panel: state });
}

describe("add-on panel", () => {
  it("labels Expedited from the option price and unit", () => {
    const html = renderToStaticMarkup(
      createElement(AddonPanel, {
        panel: panel({
          options: [{ id: "expedited", label: "Expedited", unitCents: 995, per: "order", totalCents: 995 }],
          selected: [],
          totalCents: 1995,
        }),
      }),
    );
    expect(html).toContain("Expedited");
    expect(html).toContain("$9.95 per order");
    expect(html).not.toContain("per page");

    const custom = renderToStaticMarkup(
      createElement(AddonPanel, {
        panel: panel({
          options: [{ id: "expedited", label: "Expedited", unitCents: 1500, per: "order", totalCents: 1500 }],
          selected: [],
          totalCents: 1995,
        }),
      }),
    );
    expect(custom).toContain("$15.00 per order");
    expect(custom).not.toContain("$9.95");
    expect(custom).not.toContain("per page");
  });

  it("hides Expedited on a translation preview and keeps it on an evaluation", () => {
    const leaked: PreviewOrder = {
      ...CERTIFICATE_PREVIEW,
      product: "translation",
      addonOptions: [
        ...addonOptions(3, { orderType: "translation" }),
        { id: "expedited", label: "Expedited", unitCents: 995, per: "page", totalCents: 2985 },
      ],
      addons: ["expedited", "notarization"],
    };
    const translation = renderToStaticMarkup(createElement(Hooked, { order: leaked }));
    expect(translation).not.toContain("Expedited");
    expect(translation).not.toContain('data-testid="addon-expedited"');
    expect(translation).not.toContain("per page");
    expect(translation).toContain("$17.95 per order");
    expect(
      checkoutPayload(addonOptions(3, { orderType: "translation" }), ["expedited", "notarization"], {
        name: "",
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "US",
      }).addons,
    ).toEqual(["notarization"]);

    const evaluation: PreviewOrder = {
      ...CERTIFICATE_PREVIEW,
      product: "evaluation",
      addonOptions: addonOptions(3, { orderType: "evaluation", service: "diploma" }),
    };
    const html = renderToStaticMarkup(createElement(Hooked, { order: evaluation }));
    expect(html).toContain('data-testid="addon-expedited"');
    expect(html).toContain("$9.95 per order");
    expect(html).not.toContain("per page");
  });
});
