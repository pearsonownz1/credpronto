import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import { addonOptions, addonStripeLines, chargeCents, parseCheckoutBody, serviceCents } from "./addons";

const address = {
  name: "Ada Lovelace",
  line1: "2520 Venture Oaks Way",
  line2: "Suite 120",
  city: "Sacramento",
  state: "CA",
  postalCode: "95833",
  country: "US",
};

describe("checkout add-ons", () => {
  it("prices every option from the billable pages", () => {
    expect(addonOptions(3)).toEqual([
      { id: "notarization", label: "Notarization", unitCents: 1795, per: "order", totalCents: 1795 },
      { id: "mail", label: "USPS Priority hard copy", unitCents: 1295, per: "order", totalCents: 1295 },
      { id: "expedited", label: "Expedited", unitCents: 995, per: "page", totalCents: 2985 },
    ]);
    expect(addonOptions(null)[2]?.totalCents).toBeNull();
    expect(chargeCents(2985, addonOptions(3), ["notarization", "expedited"])).toBe(7765);
    expect(chargeCents(2985, addonOptions(null), ["expedited"])).toBeNull();
  });

  it("keeps the service price separate from add-ons", () => {
    expect(
      serviceCents({
        billablePages: 3,
        unitPriceCents: 995,
        service: null,
        evaluationCents: null,
        translationCents: null,
      }),
    ).toBe(2985);
    expect(
      serviceCents({
        billablePages: 2,
        unitPriceCents: 995,
        service: "diploma",
        evaluationCents: 1995,
        translationCents: 1990,
      }),
    ).toBe(3985);
  });

  it("accepts a mail address and prices expedited per page", () => {
    const selection = parseCheckoutBody(
      { addons: ["expedited", "mail", "notarization"], shippingAddress: { ...address, state: "ca" } },
      3,
    );
    expect(selection.addons.map((item) => item.id)).toEqual(["notarization", "mail", "expedited"]);
    expect(selection.addonCents).toBe(1795 + 1295 + 2985);
    expect(selection.shippingAddress).toMatchObject({ state: "CA", country: "US", line2: "Suite 120" });
    expect(addonStripeLines(selection.addons)).toEqual([
      { name: "Notarization", quantity: 1, unitAmountCents: 1795 },
      { name: "USPS Priority hard copy", quantity: 1, unitAmountCents: 1295 },
      { name: "Expedited", quantity: 3, unitAmountCents: 995 },
    ]);
  });

  it("rejects mail without a US address and unknown add-ons", () => {
    expect(() => parseCheckoutBody({ addons: ["mail"] }, 1)).toThrow(HttpError);
    expect(() => parseCheckoutBody({ addons: ["mail"], shippingAddress: { ...address, country: "MX" } }, 1)).toThrow(
      "Mail requires a US shipping address",
    );
    expect(() => parseCheckoutBody({ addons: ["notarization", "notarization"] }, 1)).toThrow("Unknown add-on");
    expect(() => parseCheckoutBody({ addons: ["rush"] }, 1)).toThrow("Unknown add-on");
    expect(() => parseCheckoutBody({ addons: ["expedited"] }, null)).toThrow("Expedited needs a page count");
    expect(parseCheckoutBody({}, 2).addons).toEqual([]);
  });

  it("stores add-ons without creating an enum", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20261012080000_order_addons.sql"),
      "utf8",
    );
    expect(sql).toMatch(/create table public\.order_addons/);
    expect(sql).toContain("addon_id in ('notarization', 'mail', 'expedited')");
    expect(sql.toLowerCase()).not.toMatch(/create type/);
    expect(sql).toContain("total_cents = billable_pages * unit_price_cents + addon_cents");
    expect(sql).toContain("total_cents = evaluation_cents + translation_cents + addon_cents");
  });
});
