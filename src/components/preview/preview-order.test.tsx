import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddonPanel, checkoutPayload } from "./addon-panel";
import { MobileBuyBar, OrderRail } from "./preview-chrome";
import type { AddonPanelState } from "./addon-panel";
import {
  CERTIFICATE_PREVIEW,
  LONG_PREVIEW,
  buyLabel,
  formatMoney,
  pagesAlign,
  type PreviewOrder,
} from "./preview-order";

describe("preview order", () => {
  it("formats cents and the buy label", () => {
    expect(formatMoney(1990)).toBe("$19.90");
    expect(buyLabel(CERTIFICATE_PREVIEW)).toBe("Buy & download — $29.85");
  });

  it("prices the buy label from the returned options", () => {
    const order: PreviewOrder = {
      ...CERTIFICATE_PREVIEW,
      addonOptions: [
        { id: "notarization", label: "Stamp", unitCents: 50, per: "order", totalCents: 50 },
      ],
    };
    expect(buyLabel(order, ["notarization"])).toBe("Buy & download — $30.35");
    expect(buyLabel(order, ["mail"])).toBe("Buy & download — $29.85");
    expect(buyLabel(order)).toBe("Buy & download — $29.85");
    expect(
      checkoutPayload(order.addonOptions ?? [], ["notarization"], {
        name: "Ada",
        line1: "1 Main",
        line2: "",
        city: "Austin",
        state: "tx",
        postalCode: "78701",
        country: "ca",
      }),
    ).toEqual({ addons: ["notarization"] });
    expect(
      checkoutPayload(order.addonOptions ?? [], ["mail"], {
        name: " Ada ",
        line1: " 1 Main ",
        line2: "",
        city: "Austin",
        state: "tx",
        postalCode: "78701",
        country: "ca",
      }).shippingAddress,
    ).toMatchObject({ state: "TX", country: "CA", line2: null, name: "Ada" });
  });

  it("matches translation page N to original page N, with point sizes", () => {
    expect(CERTIFICATE_PREVIEW.pageCount).toBe(3);
    expect(CERTIFICATE_PREVIEW.pricing.totalCents).toBe(3 * 995);
    expect(pagesAlign(CERTIFICATE_PREVIEW)).toBe(true);
    expect(pagesAlign(LONG_PREVIEW)).toBe(true);
    expect(LONG_PREVIEW.original.pages[9]).toEqual({
      page: 10,
      widthPt: 612,
      heightPt: 792,
    });
  });

  it("shows a translation speed line only when the order carries one", () => {
    const shown = renderToStaticMarkup(
      <OrderRail
        order={{ ...CERTIFICATE_PREVIEW, speedLine: "Translated in 4.2 seconds" }}
        corrections={[]}
        panel={panel({ options: [], selected: [], totalCents: 995 })}
      />,
    );
    expect(shown).toContain('data-testid="translation-speed"');
    expect(shown).toContain("Translated in 4.2 seconds");
    expect(shown).toContain("text-ink-muted");
    const hidden = renderToStaticMarkup(
      <OrderRail
        order={CERTIFICATE_PREVIEW}
        corrections={[]}
        panel={panel({ options: [], selected: [], totalCents: 995 })}
      />,
    );
    expect(hidden).not.toContain("Translated in");
    expect(hidden).not.toContain('data-testid="translation-speed"');
  });

  it("renders returned add-ons, the mail form, and the address error", () => {
    const html = renderToStaticMarkup(
      <OrderRail
        order={{
          ...CERTIFICATE_PREVIEW,
          addonOptions: [
            { id: "notarization", label: "Stamp", unitCents: 50, per: "order", totalCents: 50 },
            { id: "mail", label: "Posted copy", unitCents: 80, per: "order", totalCents: 80 },
          ],
        }}
        corrections={[]}
        panel={panel({
          options: [
            { id: "notarization", label: "Stamp", unitCents: 50, per: "order", totalCents: 50 },
            { id: "mail", label: "Posted copy", unitCents: 80, per: "order", totalCents: 80 },
          ],
          selected: ["mail"],
          error: "Mail requires a US shipping address",
          totalCents: 2985 + 80,
        })}
      />,
    );
    expect(html).toContain("Stamp");
    expect(html).toContain("Posted copy");
    expect(html).toContain("$0.50");
    expect(html).toContain("$0.80");
    expect(html).not.toContain("$17.95");
    expect(html).not.toContain("Expedited");
    expect(html).toContain("shipping-address");
    expect(html).toContain("Mail requires a US shipping address");
    expect(html).toContain("Buy &amp; download — $30.65");
  });

  it("offers notarization and mail without Expedited", () => {
    const options = CERTIFICATE_PREVIEW.addonOptions ?? [];
    expect(options.map((option) => option.label)).toEqual(["Notarization", "USPS Priority hard copy"]);
    const html = renderToStaticMarkup(
      <OrderRail
        order={{ ...CERTIFICATE_PREVIEW, pageCount: 1, pricing: { ...CERTIFICATE_PREVIEW.pricing, pages: 1, totalCents: 995 }, addonOptions: options }}
        corrections={[]}
        panel={panel({ options, selected: ["notarization"], totalCents: 995 + 1795 })}
      />,
    );
    expect(html).toContain("1 page × $9.95");
    expect(html).toContain("Notarization");
    expect(html).toContain("USPS Priority hard copy");
    expect(html).not.toContain("Expedited");
    expect(html).toContain("$17.95 per order");
    expect(html).not.toContain("per page");
    expect(
      checkoutPayload(options, ["expedited", "notarization"], {
        name: "Ada",
        line1: "1 Main",
        line2: "",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        country: "US",
      }),
    ).toEqual({ addons: ["notarization"] });
  });

  it("pluralizes a one-page sidebar price and the mobile count", () => {
    const order: PreviewOrder = {
      ...CERTIFICATE_PREVIEW,
      pageCount: 1,
      pricing: { ...CERTIFICATE_PREVIEW.pricing, pages: 1, totalCents: 995 },
    };
    const rail = renderToStaticMarkup(
      <OrderRail order={order} corrections={[]} panel={panel({ options: [], selected: [], totalCents: 995 })} />,
    );
    expect(rail).toContain("1 page × $9.95");
    expect(rail).not.toContain("1 pages");
    const bar = renderToStaticMarkup(
      <MobileBuyBar
        order={order}
        onFlag={() => undefined}
        panel={panel({ options: [], selected: [], totalCents: 995 })}
      />,
    );
    expect(bar).toContain("1 page · certified");
    expect(bar).not.toContain("1 pages");
  });

  it("hides the add-on panel when the order returns none", () => {
    const html = renderToStaticMarkup(
      <OrderRail
        order={{ ...CERTIFICATE_PREVIEW, addonOptions: [] }}
        corrections={[]}
        panel={panel({ options: [], selected: [], totalCents: 2985 })}
      />,
    );
    expect(html).not.toContain("addon-panel");
    expect(html).not.toContain("shipping-address");
  });

  it("keeps payment on the evaluation review, with the flat fee and add-ons", () => {
    const options = [
      { id: "notarization" as const, label: "Notarization", unitCents: 1795, per: "order" as const, totalCents: 1795 },
      { id: "mail" as const, label: "USPS Priority hard copy", unitCents: 1295, per: "order" as const, totalCents: 1295 },
    ];
    const order: PreviewOrder = {
      ...CERTIFICATE_PREVIEW,
      product: "evaluation",
      filename: "test_diploma.png",
      pageCount: 1,
      pricing: {
        perPageCents: 1995,
        pages: 1,
        certificationIncluded: true,
        totalCents: 1995,
        lines: [{ label: "Diploma evaluation", amountCents: 1995 }],
      },
      addonOptions: options,
      evaluationDetails: [
        { label: "Credential holder", value: "Ada Lovelace" },
        { label: "School", value: "Example University" },
        { label: "Degree", value: "Licence" },
        { label: "Dates", value: "2018–2022" },
        { label: "U.S. equivalency", value: "Bachelor's degree" },
      ],
      included: [
        "Watermark removed after payment",
        "Signed by a credential evaluator",
        "Emailed and downloadable",
      ],
    };
    const html = renderToStaticMarkup(
      <OrderRail order={order} corrections={[]} panel={panel({ options, selected: [], totalCents: 1995 })} />,
    );
    expect(html).toContain("Review the report, then buy.");
    expect(html).toContain("Diploma evaluation");
    expect(html).toContain("$19.95");
    expect(html).toContain("Total");
    expect(html).not.toContain("Credential holder");
    expect(html).not.toContain("School");
    expect(html).not.toContain("Licence");
    expect(html).not.toContain("2018–2022");
    expect(html).not.toContain("U.S. equivalency");
    expect(html).not.toContain('data-testid="evaluation-detail"');
    expect(html).toContain("Notarization");
    expect(html).toContain("$17.95 per order");
    expect(html).toContain("USPS Priority hard copy");
    expect(html).toContain("$12.95 per order");
    expect(html).toContain("Pay $19.95");
    expect(html).toContain('data-testid="buy-download"');
    expect(html).not.toContain("download-evaluation");
    expect(html).not.toContain("edit-translation");
    expect(html).not.toContain("Expedited");
    expect(html).toContain("Watermark removed after payment");
    expect(buyLabel(order)).toBe("Pay $19.95");
    expect(buyLabel(order, ["notarization", "mail"])).toBe("Pay $50.85");
  });

  it("drops Expedited from the buy panel", () => {
    const html = renderToStaticMarkup(
      <AddonPanel
        panel={panel({
          options: [
            { id: "notarization", label: "Notarization", unitCents: 1795, per: "order", totalCents: 1795 },
            { id: "expedited", label: "Expedited", unitCents: 995, per: "order", totalCents: 995 },
          ],
          selected: ["expedited"],
          totalCents: 1995,
        })}
      />,
    );
    expect(html).toContain("Notarization");
    expect(html).not.toContain("Expedited");
    expect(html).not.toContain('data-testid="addon-expedited"');
  });
});

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
