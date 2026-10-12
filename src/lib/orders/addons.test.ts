import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  addonOptions,
  addonStripeLines,
  chargeCents,
  expeditedFlagForAddons,
  offeredAddonOptions,
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
  it("prices Expedited once per evaluation order and omits it from translations", () => {
    const shared = [
      { id: "notarization", label: "Notarization", unitCents: 1795, per: "order", totalCents: 1795 },
      { id: "mail", label: "USPS Priority hard copy", unitCents: 1295, per: "order", totalCents: 1295 },
    ];
    expect(addonOptions(3, translation)).toEqual(shared);
    expect(addonOptions(3)).toEqual(shared);
    expect(addonOptions(3, evaluation)).toEqual([
      ...shared,
      { id: "expedited", label: "Expedited", unitCents: 995, per: "order", totalCents: 995 },
    ]);
    expect(addonOptions(12, course).find((item) => item.id === "expedited")).toMatchObject({
      per: "order",
      unitCents: 995,
      totalCents: 995,
    });
    expect(addonOptions(null, evaluation).find((item) => item.id === "expedited")?.totalCents).toBe(995);
    expect(chargeCents(2985, addonOptions(3, evaluation), ["notarization", "expedited"])).toBe(2985 + 1795 + 995);
    expect(chargeCents(2985, addonOptions(null, evaluation), ["expedited"])).toBe(2985 + 995);
    expect(chargeCents(2985, addonOptions(3, translation), ["expedited"])).toBeNull();
    expect(chargeCents(1995, addonOptions(1, evaluation), [])).toBe(1995);
    expect(chargeCents(3995, addonOptions(1, course), [])).toBe(3995);
    expect(offeredAddonOptions(1, "translation").map((option) => option.id)).toEqual(["notarization", "mail"]);
    expect(offeredAddonOptions(1, "evaluation").map((option) => option.id)).toEqual([
      "notarization",
      "mail",
      "expedited",
    ]);
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

  it("accepts a mail address and prices expedited once per evaluation order", () => {
    const selection = parseCheckoutBody(
      { addons: ["expedited", "mail", "notarization"], shippingAddress: { ...address, state: "ca" } },
      3,
      evaluation,
    );
    expect(selection.addons.map((item) => item.id)).toEqual(["notarization", "mail", "expedited"]);
    expect(selection.addonCents).toBe(1795 + 1295 + 995);
    expect(selection.shippingAddress).toMatchObject({ state: "CA", country: "US", line2: "Suite 120" });
    expect(addonStripeLines(selection.addons)).toEqual([
      { name: "Notarization", quantity: 1, unitAmountCents: 1795 },
      { name: "USPS Priority hard copy", quantity: 1, unitAmountCents: 1295 },
      { name: "Expedited", quantity: 1, unitAmountCents: 995 },
    ]);
    expect(selection.addons.find((item) => item.id === "expedited")).toMatchObject({ per: "order", quantity: 1 });
  });

  it("rejects mail without a US address and unknown add-ons", () => {
    expect(() => parseCheckoutBody({ addons: ["mail"] }, 1)).toThrow(HttpError);
    expect(() => parseCheckoutBody({ addons: ["mail"], shippingAddress: { ...address, country: "MX" } }, 1)).toThrow(
      "Mail requires a US shipping address",
    );
    expect(() => parseCheckoutBody({ addons: ["notarization", "notarization"] }, 1)).toThrow("Unknown add-on");
    expect(() => parseCheckoutBody({ addons: ["rush"] }, 1)).toThrow("Unknown add-on");
    expect(parseCheckoutBody({ addons: ["expedited"] }, null, evaluation).addonCents).toBe(995);
    expect(parseCheckoutBody({}, 2).addons).toEqual([]);
  });

  it("rejects expedited on translation orders and stores it only for evaluations", () => {
    expect(() => parseCheckoutBody({ addons: ["expedited"] }, 3, translation)).toThrow(HttpError);
    expect(() => parseCheckoutBody({ addons: ["expedited"] }, null, translation)).toThrow("Expedited is no longer offered");
    expect(() => parseCheckoutBody({ addons: ["notarization", "expedited"] }, 2, { serviceType: "translation" })).toThrow(
      "Expedited is no longer offered",
    );
    expect(() => parseCheckoutBody({ addons: ["expedited"] }, 3, {})).toThrow("Expedited is no longer offered");
    const priced = parseCheckoutBody({ addons: ["expedited"] }, 4, { serviceType: "evaluation" });
    expect(priced.addons).toEqual([
      { id: "expedited", label: "Expedited", unitCents: 995, per: "order", quantity: 1, totalCents: 995 },
    ]);
    expect(priced.addonCents).toBe(995);
    expect(parseCheckoutBody({ addons: ["expedited"] }, 12, course).addonCents).toBe(995);
    expect(expeditedFlagForAddons(translation, [])).toBe(false);
    expect(expeditedFlagForAddons(evaluation, [{ id: "expedited" }])).toBe(true);
    expect(expeditedFlagForAddons(course, [{ id: "expedited" }])).toBe(true);
    expect(expeditedFlagForAddons({ service: "diploma" }, [{ id: "mail" }])).toBe(false);
    expect(() => expeditedFlagForAddons(translation, [{ id: "expedited" }])).toThrow("Expedited is no longer offered");
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
