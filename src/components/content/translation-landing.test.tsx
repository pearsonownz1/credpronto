import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_PAGE_LABEL,
} from "@/lib/evaluations/catalog";
import { formatMoney } from "@/lib/flow/pricing";
import { ADDON_CATALOG } from "@/lib/orders/addons";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { EvaluationLanding } from "./evaluation-landing";
import { TranslationLanding } from "./translation-landing";

const BANNED = /\bGuy\b|Pearson|\bGCS\b|GEO Credential Services|ImmiTranslate|Zooma/i;

describe("translation landing", () => {
  const html = renderToStaticMarkup(createElement(TranslationLanding));

  it("renders the headline, price, preview, and certification copy", () => {
    expect(html).toContain("Certified translations accepted by USCIS, and you see them first");
    expect(html).toContain(TRANSLATION_PAGE_LABEL);
    expect(html).toContain(`${formatMoney(UNIT_PRICE_CENTS)} per page`);
    expect(html).toContain("8 CFR 103.2(b)(3)");
    expect(html).toContain('href="/translate"');
    expect(html).not.toContain("/sign-up");
    expect(html).toContain("Get started");
    expect(html).toContain("data-testid=\"translation-preview\"");
    expect(html).toContain("hero-docs.png");
    expect(html).toContain('width="1583"');
    expect(html).toContain('height="1088"');
    expect(html).toContain('rel="preload"');
    expect(html).toContain(
      "CredPronto side-by-side preview of a Turkish tax letter and its certified English translation",
    );
    expect(html).toContain("USCIS accepted");
    expect(html).toContain("Preview before you pay");
    expect(html).toContain("Certified PDF by email");
    expect(html).toContain("Upload");
    expect(html).toContain("Confirm the details");
    expect(html).toContain("Preview for free");
    expect(html).toContain("Pay and download");
    expect(html).toContain("Most previews are ready in 3 minutes.");
    expect(html).toContain("Birth certificates");
    expect(html).toContain("Green card, citizenship and visa applicants");
    expect(html).toContain("You see the exact total before you upload anything.");
    expect(html).toContain("Does USCIS accept CredPronto translations?");
    expect(html).toContain('href="/guides/uscis-certified-translation"');
    expect(html).toContain(DIPLOMA_PRICE_LABEL);
    expect(html).toContain(COURSE_BY_COURSE_PRICE_LABEL);
    const notarization = ADDON_CATALOG.find((item) => item.id === "notarization");
    const mail = ADDON_CATALOG.find((item) => item.id === "mail");
    expect(html).toContain(formatMoney(notarization?.unitCents ?? 0));
    expect(html).toContain(formatMoney(mail?.unitCents ?? 0));
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(/USCIS accepts/i);
  });
});

describe("evaluation landing", () => {
  const html = renderToStaticMarkup(createElement(EvaluationLanding));

  it("renders the approved headings without a timed promise", () => {
    expect(html).toContain("What a credential evaluation is");
    expect(html).toContain("Which evaluation do you need?");
    expect(html).toContain("Common uses");
    expect(html).toContain("What to upload");
    expect(html).toContain("How it works");
    expect(html).toContain("Sign-off");
    expect(html).toContain(DIPLOMA_PRICE_LABEL);
    expect(html).toContain(COURSE_BY_COURSE_PRICE_LABEL);
    expect(html).toContain('href="/guides/uscis-certified-translation"');
    expect(html).toContain('href="/guides/what-a-certified-translation-includes"');
    expect(html).toContain("Will my school or licensing board accept this evaluation?");
    expect(html).not.toMatch(/10[\s-]*min|ten minutes|same[\s-]*day|within minutes|instant(?:ly)?|hours or less/i);
    expect(html).not.toMatch(BANNED);
  });
});
