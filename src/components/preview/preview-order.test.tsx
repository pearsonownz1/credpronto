import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkoutPayload } from "./addon-panel";
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
