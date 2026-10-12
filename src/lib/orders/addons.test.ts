import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  addonOptions,
  addonStripeLines,
  chargeCents,
  expeditedFlagForAddons,
  parseCheckoutBody,
  serviceCents,
} from "./addons";

const evaluation = { serviceType: "evaluation" as const, orderType: "evaluation" as const, service: "diploma" as const };
const course = { serviceType: "evaluation" as const, orderType: "evaluation" as const, service: "course_by_course" as const };
const translation = { serviceType: "translation" as const, orderType: "translation" as const, service: null };

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
  it("prices notarization and mail once per order and omits expedited", () => {
    const offered = [
      { id: "notarization", label: "Notarization", unitCents: 1795, per: "order", totalCents: 1795 },
      { id: "mail", label: "USPS Priority hard copy", unitCents: 1295, per: "order", totalCents: 1295 },
    ];
    expect(addonOptions(3, translation)).toEqual(offered);
    expect(addonOptions(3, evaluation)).toEqual(offered);
    expect(addonOptions(12, course)).toEqual(offered);
    expect(addonOptions(null, evaluation).map((item) => item.id)).toEqual(["notarization", "mail"]);
    expect(chargeCents(2985, addonOptions(3, evaluation), ["notarization"])).toBe(2985 + 1795);
    expect(chargeCents(2985, addonOptions(3, translation), ["expedited"])).toBeNull();
    expect(chargeCents(1995, addonOptions(1, evaluation), [])).toBe(1995);
    expect(chargeCents(3995, addonOptions(1, course), [])).toBe(3995);
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

  it("accepts a mail address and leaves expedited off the Stripe lines", () => {
    const selection = parseCheckoutBody(
      { addons: ["mail", "notarization"], shippingAddress: { ...address, state: "ca" } },
      3,
      evaluation,
    );
    expect(selection.addons.map((item) => item.id)).toEqual(["notarization", "mail"]);
    expect(selection.addonCents).toBe(1795 + 1295);
    expect(selection.shippingAddress).toMatchObject({ state: "CA", country: "US", line2: "Suite 120" });
    expect(addonStripeLines(selection.addons)).toEqual([
      { name: "Notarization", quantity: 1, unitAmountCents: 1795 },
      { name: "USPS Priority hard copy", quantity: 1, unitAmountCents: 1295 },
    ]);
    expect(addonStripeLines(selection.addons).map((line) => line.name)).not.toContain("Expedited");
  });

  it("rejects mail without a US address and unknown add-ons", () => {
    expect(() => parseCheckoutBody({ addons: ["mail"] }, 1)).toThrow(HttpError);
    expect(() => parseCheckoutBody({ addons: ["mail"], shippingAddress: { ...address, country: "MX" } }, 1)).toThrow(
      "Mail requires a US shipping address",
    );
    expect(() => parseCheckoutBody({ addons: ["notarization", "notarization"] }, 1)).toThrow("Unknown add-on");
    expect(() => parseCheckoutBody({ addons: ["rush"] }, 1)).toThrow("Unknown add-on");
    expect(parseCheckoutBody({}, 2).addons).toEqual([]);
  });

  it("rejects expedited on every order type", () => {
    for (const order of [translation, evaluation, course, { serviceType: "evaluation" }, {}]) {
      expect(() => parseCheckoutBody({ addons: ["expedited"] }, 3, order)).toThrow(HttpError);
      expect(() => parseCheckoutBody({ addons: ["expedited"] }, null, order)).toThrow("Expedited is no longer offered");
      expect(() => parseCheckoutBody({ addons: ["notarization", "expedited"] }, 2, order)).toThrow(
        "Expedited is no longer offered",
      );
      expect(() => expeditedFlagForAddons(order, [{ id: "expedited" }])).toThrow("Expedited is no longer offered");
    }
    expect(expeditedFlagForAddons(evaluation, [])).toBe(false);
    expect(expeditedFlagForAddons(course, [{ id: "mail" }])).toBe(false);
    expect(expeditedFlagForAddons(translation, [{ id: "notarization" }])).toBe(false);
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
