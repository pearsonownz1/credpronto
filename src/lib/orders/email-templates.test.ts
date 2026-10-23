import { describe, expect, it } from "vitest";
import { UNIT_PRICE_CENTS } from "./constants";
import {
  EMAIL_FOOTER_ADDRESS,
  EMAIL_LOGO_URL,
  documentSummary,
  emailGreetingName,
  formatPaymentMethod,
  receiptLineItems,
  FINAL_DOWNLOAD_SUBJECT,
  renderAuthLinkEmail,
  renderFinalDownloadEmail,
  renderPreEvaluationEmail,
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

    const evaluation = renderOrderReceivedEmail({
      customerName: null,
      orderId: "order-9",
      sourceLanguage: "es",
      targetLanguage: "en",
      documentCount: 1,
      pageCount: 1,
      estimatedCents: 1995,
      trackUrl: ORDER_URL,
      product: "evaluation",
    });
    expect(evaluation.html).toContain("An evaluator reviews them after payment");
    expect(evaluation.html).not.toContain("free side-by-side preview");
    expect(evaluation.html).toContain("Evaluation ready");
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

    const finalDownload = renderFinalDownloadEmail({
      orderId: "order-9",
      totalCents: 11050,
      lines,
      downloadUrl: ORDER_URL,
      filename: "Tax-status-letter-certified-translation.pdf",
    });
    expect(finalDownload.subject).toBe("Thanks for your payment.  You can download your document now!");
    expect(finalDownload.subject).toBe(FINAL_DOWNLOAD_SUBJECT);
    expect(finalDownload.subject).toContain(".  You");
    expect(finalDownload.html).toContain("order-9");
    expect(finalDownload.html).toContain("Total paid");
    expect(finalDownload.html).toContain("$110.50");
    expect(finalDownload.html).toContain("Certified translation · 4 pages × $9.95");
    expect(finalDownload.html).toContain(`href="${ORDER_URL}"`);
    expect(finalDownload.html).toContain("Tax-status-letter-certified-translation.pdf");
    expect(finalDownload.text).toContain(`Download your document: ${ORDER_URL}`);

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
    expect(evaluation.map((line) => line.amountCents)).toEqual([3990, 1990]);
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

describe("auth link email", () => {
  it("points at token_hash verify on /auth/confirm", () => {
    const confirmUrl =
      "https://credpronto.com/auth/confirm?token_hash=sample-hash&type=signup&next=%2Faccount";
    const rendered = renderAuthLinkEmail({ confirmUrl, purpose: "signup" });
    expect(rendered.html).toContain('href="https://credpronto.com/auth/confirm?token_hash=sample-hash&amp;type=signup&amp;next=%2Faccount"');
    expect(rendered.text).toContain("/auth/confirm");
    expect(rendered.text).toContain("token_hash=sample-hash");
    expect(rendered.html).toContain("#1F5EFF");
    expect(rendered.html).toContain("border-radius:4px");
    expect(rendered.subject).toBe("Confirm your CredPronto account");
  });
});

describe("pre-evaluation result email", () => {
  it("links back to the suggestion and on to the paid evaluation", () => {
    const preview = new Uint8Array(Buffer.from("%PDF-watermarked-preview"));
    const original = new Uint8Array(Buffer.from("%PDF-original-diploma"));
    const rendered = renderPreEvaluationEmail({
      equivalent: "Bachelor's degree",
      confidenceLabel: "High",
      rationale: "The printed Licenciatura from Mexico matches a known credential. This is a free suggestion, not an official evaluation.",
      resultUrl: "https://credpronto.test/pre-evaluation/token",
      officialUrl: "https://credpronto.test/sign-up?email=ada%40example.com&next=%2Ftranslate",
      attachment: { filename: "preview.pdf", content: preview, contentType: "application/pdf" },
    });
    expect(rendered.subject).toBe("Your CredPronto equivalency suggestion");
    expect(rendered.text).toContain("Bachelor's degree");
    expect(rendered.text).toContain("Confidence: High");
    expect(rendered.text).toContain("watermarked preview");
    expect(rendered.text).toContain("https://credpronto.test/pre-evaluation/token");
    expect(rendered.text).toContain("https://credpronto.test/sign-up?email=ada%40example.com&next=%2Ftranslate");
    expect(rendered.html).toContain("Order an official evaluation");
    expect(rendered.attachment.filename).toBe("preview.pdf");
    expect(rendered.attachment.contentType).toBe("application/pdf");
    expect(Buffer.compare(Buffer.from(rendered.attachment.content), Buffer.from(preview))).toBe(0);
    expect(Buffer.compare(Buffer.from(rendered.attachment.content), Buffer.from(original))).not.toBe(0);
    expect(rendered.html).not.toContain("original-diploma");
    expect(rendered.text).not.toMatch(/\bEDGE\b/);
    expect(rendered.html).not.toMatch(/\bEDGE\b/);
  });
});
