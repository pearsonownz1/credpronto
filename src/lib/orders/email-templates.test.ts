import { describe, expect, it } from "vitest";
import { UNIT_PRICE_CENTS } from "./constants";
import {
  EMAIL_FOOTER_ADDRESS,
  EMAIL_LOGO_URL,
  documentSummary,
  emailGreetingName,
  formatPaymentMethod,
  receiptLineItems,
  renderOrderReceivedEmail,
  renderPaymentReceiptEmail,
  renderPreviewReadyEmail,
} from "./email-templates";

const ORDER_URL = "https://www.credpronto.com/order/tok_live_93";

function expectSharedChrome(html: string) {
  expect(html).toContain(`src="${EMAIL_LOGO_URL}"`);
  expect(html).toContain(EMAIL_FOOTER_ADDRESS);
  expect(html).toContain('role="presentation"');
  expect(html).toContain("style=");
  expect(html).not.toMatch(/\.svg/i);
  expect(html).not.toContain("credpronto-logo.svg");
  expect(html).not.toContain("María");
  expect(html).not.toContain("CP-24817");
  expect(html).not.toContain("CP-R-24817");
}

describe("email templates", () => {
  it("renders the order-received email from the order, never sample copy", () => {
    expect(emailGreetingName("Ada Lovelace")).toBe("Ada");
    expect(emailGreetingName("ada@example.com")).toBeNull();
    expect(emailGreetingName("  ")).toBeNull();

    const rendered = renderOrderReceivedEmail({
      customerName: "Ada Lovelace",
      orderId: "4b7cd466-eb4f-4cdb-8cbf-c62a9efcfcc8",
      sourceLanguage: null,
      targetLanguage: "en",
      documentCount: 2,
      pageCount: null,
      estimatedCents: null,
      trackUrl: ORDER_URL,
    });

    expectSharedChrome(rendered.html);
    expect(rendered.subject).toBe("We received your CredPronto documents");
    expect(rendered.html).toContain("We're on it, Ada.");
    expect(rendered.html).toContain("We'll confirm the language");
    expect(rendered.html).toContain("2 documents");
    expect(rendered.html).not.toContain("pages");
    expect(rendered.html).toContain("Pending");
    expect(rendered.html).toContain("4b7cd466-eb4f-4cdb-8cbf-c62a9efcfcc8");
    expect(rendered.html).toContain(`href="${ORDER_URL}"`);
    expect(rendered.html).toContain("Track your order");
    expect(rendered.text).toContain(ORDER_URL);

    const priced = renderOrderReceivedEmail({
      customerName: null,
      orderId: "order-9",
      sourceLanguage: "es",
      targetLanguage: "en",
      documentCount: 1,
      pageCount: 3,
      estimatedCents: 1995,
      trackUrl: ORDER_URL,
    });
    expect(priced.html).toContain("We're on it.");
    expect(priced.html).not.toContain("We're on it,");
    expect(priced.html).toContain("Spanish to English");
    expect(priced.html).toContain("1 document · 3 pages");
    expect(priced.html).toContain("$19.95");
  });

  it("renders the preview-ready email with a view-and-pay link to the order", () => {
    const rendered = renderPreviewReadyEmail({
      orderId: "order-9",
      sourceLanguage: "es",
      targetLanguage: "en",
      documentCount: 3,
      pageCount: 4,
      totalCents: 3980,
      payUrl: ORDER_URL,
      includesTranslation: true,
    });

    expectSharedChrome(rendered.html);
    expect(rendered.html).toContain("Your translation is ready.");
    expect(rendered.html).toContain("certified Spanish to English translation");
    expect(rendered.html).toContain("Order order-9");
    expect(rendered.html).toContain("3 documents · 4 certified pages");
    expect(rendered.html).toContain("Includes signed certification cover page");
    expect(rendered.html).toContain("$39.80");
    expect(rendered.html).toContain("View and pay");
    expect(rendered.html).toContain(`href="${ORDER_URL}"`);
    expect(rendered.text).toContain(`View and pay: ${ORDER_URL}`);

    const evaluation = renderPreviewReadyEmail({
      orderId: "order-9",
      sourceLanguage: "en",
      targetLanguage: "en",
      documentCount: 1,
      pageCount: 2,
      totalCents: 1995,
      payUrl: null,
      includesTranslation: false,
    });
    expect(evaluation.html).toContain("Your evaluation is ready.");
    expect(evaluation.html).toContain("credential evaluation");
    expect(evaluation.html).not.toContain("View and pay");
    expect(evaluation.html).toContain("earlier email");
  });

  it("renders the receipt with add-on line items, the total, and a download link", () => {
    const lines = receiptLineItems({
      service: null,
      degreeCount: null,
      evaluationCents: null,
      translationCents: null,
      billablePages: 4,
      unitPriceCents: UNIT_PRICE_CENTS,
      addons: [
        { id: "notarization", quantity: 1, unitCents: 1795, totalCents: 1795 },
        { id: "mail", quantity: 1, unitCents: 1295, totalCents: 1295 },
        { id: "expedited", quantity: 4, unitCents: 995, totalCents: 3980 },
      ],
    });
    expect(lines).toEqual([
      { label: "Certified translation · 4 pages × $9.95", amountCents: 3980 },
      { label: "Notarization", amountCents: 1795 },
      { label: "USPS Priority hard copy", amountCents: 1295 },
      { label: "Expedited · 4 × $9.95", amountCents: 3980 },
    ]);
    expect(formatPaymentMethod("visa", "4242")).toBe("Visa •••• 4242");
    expect(formatPaymentMethod("visa", "42")).toBeNull();
    expect(documentSummary(1, 1, true)).toBe("1 document · 1 certified page");

    const rendered = renderPaymentReceiptEmail({
      downloadUrl: ORDER_URL,
      receiptNumber: "pay_93",
      paidAt: "2026-10-11T18:04:00.000Z",
      paymentLabel: "Visa •••• 1881",
      lines,
      totalCents: 11050,
    });

    expectSharedChrome(rendered.html);
    expect(rendered.html).toContain("Payment received. Thank you!");
    expect(rendered.html).toContain("Download certified PDF");
    expect(rendered.html).toContain(`href="${ORDER_URL}"`);
    expect(rendered.html).toContain("pay_93");
    expect(rendered.html).toContain("October 11, 2026");
    expect(rendered.html).toContain("Visa •••• 1881");
    expect(rendered.html).not.toContain("4242");
    expect(rendered.html).toContain("Certified translation · 4 pages × $9.95");
    expect(rendered.html).toContain("Notarization");
    expect(rendered.html).toContain("USPS Priority hard copy");
    expect(rendered.html).toContain("Expedited · 4 × $9.95");
    expect(rendered.html).toContain("Total paid");
    expect(rendered.html).toContain("$110.50");
    expect(rendered.text).toContain(`Download certified PDF: ${ORDER_URL}`);

    const evaluation = receiptLineItems({
      service: "diploma",
      degreeCount: 2,
      evaluationCents: 3990,
      translationCents: 1990,
      billablePages: 2,
      unitPriceCents: UNIT_PRICE_CENTS,
      addons: [],
    });
    expect(evaluation.map((line) => line.label)).toEqual([
      "Diploma evaluation · 2 × $19.95",
      "Certified translation · 2 pages × $9.95",
    ]);
    expect(
      receiptLineItems({
        service: null,
        degreeCount: null,
        evaluationCents: null,
        translationCents: null,
        billablePages: 1,
        unitPriceCents: UNIT_PRICE_CENTS,
        addons: [],
      }).map((line) => line.label),
    ).toEqual(["Certified translation · 1 page × $9.95"]);
  });
});
