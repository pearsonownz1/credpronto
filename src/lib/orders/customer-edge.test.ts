import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { webhookBody } from "./outbound-webhook";
import { renderEvaluationPdfs } from "./pdf/evaluation";
import { toPartnerOrder } from "./partner";
import {
  renderOrderReceivedEmail,
  renderPaymentReceiptEmail,
  renderPreviewReadyEmail,
} from "./email-templates";
import { customerEvaluationResult, customerReviewReason, partnerReviewReason } from "./equivalency";
import { parseEvaluationResult } from "./evaluation-price";
import type { EvaluationResult, OrderRecord } from "./types";
import { toCustomerOrder } from "./view";

const EDGE_WORD = /\bEDGE\b/i;
const CONFIDENCE_LABEL = /(?:^|[^a-z])(high|medium|low)(?:[^a-z]|$)/i;

const CUSTOMER_ROOTS = [
  "src/components/flow",
  "src/components/preview",
  "src/components/evaluations",
  "src/components/content",
  "src/components/account",
  "src/components/site-header.tsx",
  "src/components/site-footer.tsx",
  "src/components/wordmark.tsx",
  "src/app/(site)",
  "src/app/(auth)",
  "src/app/api/orders",
  "src/app/api/v1",
  "src/app/preview",
  "src/app/dashboard",
  "src/lib/orders/email.ts",
  "src/lib/orders/email-templates.ts",
  "src/lib/orders/pdf",
  "src/lib/orders/view.ts",
  "src/lib/orders/partner.ts",
  "src/lib/orders/outbound-webhook.ts",
  "src/lib/orders/public-order.ts",
];

/** Drop comments and detector regexes so the report scrubber can name what it removes. */
function shownSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/(?:\\\/|[^/\n])+\/[a-z]*/g, "");
}

function customerFiles(): string[] {
  const files: string[] = [];
  for (const root of CUSTOMER_ROOTS) {
    const abs = path.join(process.cwd(), root);
    if (!statSync(abs).isDirectory()) {
      files.push(abs);
      continue;
    }
    files.push(...walk(abs));
  }
  return files;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
  }
  return files;
}

const internalBasis = "EDGE catalog, confidence high. First university degree.";

const diploma: EvaluationResult = {
  kind: "diploma",
  credentials: [
    {
      applicant: "Ada Lovelace",
      institution: "Université de Paris",
      country: "France",
      credential: "Licence",
      field: "Mathematics",
      dates: "2016–2019",
      usEquivalency: "Bachelor's degree",
      equivalencyBasis: internalBasis,
      documentsReviewed: ["fr_diplome-licence.pdf"],
    },
  ],
  pageCount: 1,
};

function orderRecord(result: EvaluationResult): OrderRecord {
  return {
    id: "order-1",
    customerId: "customer-1",
    userId: null,
    serviceType: "evaluation",
    status: "preview_ready",
    sourceLanguage: "fr",
    targetLanguage: "en",
    languageConfirmed: true,
    billablePages: 1,
    unitPriceCents: 995,
    totalCents: 1995,
    currency: "usd",
    etaAt: null,
    reviewReason: "equivalency_qa_review",
    combinedOriginalPath: null,
    finalTranslationPath: null,
    certificationPath: null,
    pageOrderBasis: null,
    pageOrder: null,
    externalRef: null,
    orderType: "evaluation",
    service: "diploma",
    degreeCount: 1,
    evaluationCents: 1995,
    translationCents: 0,
    includeTranslation: false,
    evaluationResult: result,
    addonCents: 0,
    expedited: false,
    shippingAddress: null,
    mailStatus: null,
    mailTracking: null,
    notarizationStatus: null,
    edgeCredentialId: "cred-1",
    edgeGradingScaleId: null,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    progress: { step: "done", pagesRead: 1, pagesTotal: 1 },
  };
}

function assertCustomerCopy(label: string, value: string) {
  expect(value, label).not.toMatch(EDGE_WORD);
  expect(value, label).not.toMatch(/equivalencyBasis/);
  expect(value, label).not.toMatch(/"confidence"\s*:/);
  expect(value, label).not.toContain(internalBasis);
  expect(value, label).not.toMatch(/confidence high/i);
}

describe("customer surfaces hide the reference", () => {
  it("does not use the reference name in customer-facing source", () => {
    const hits = customerFiles().flatMap((file) => {
      const source = shownSource(readFileSync(file, "utf8"));
      if (!EDGE_WORD.test(source)) return [];
      return [path.relative(process.cwd(), file)];
    });
    expect(hits).toEqual([]);
  });

  it("drops the basis and the confidence label from orders, mail, PDFs, and API bodies", async () => {
    const stored = parseEvaluationResult({
      ...diploma,
      credentials: diploma.kind === "diploma" ? diploma.credentials : [],
    });
    expect(stored?.kind).toBe("diploma");
    if (stored?.kind !== "diploma") return;
    expect(stored.credentials[0]?.equivalencyBasis).toContain("EDGE");

    const shown = customerEvaluationResult(stored);
    if (shown.kind !== "diploma") throw new Error("expected a diploma");
    expect(shown.credentials[0]).not.toHaveProperty("equivalencyBasis");
    expect(customerReviewReason("equivalency_qa_review")).toBeNull();
    expect(customerReviewReason("high")).toBeNull();
    expect(customerReviewReason("Language detection confidence is low (0.20).")).toContain("confidence");
    expect(partnerReviewReason("high")).toBeNull();
    expect(partnerReviewReason("EDGE match")).toBeNull();
    expect(partnerReviewReason("equivalency_qa_research")).toBe("equivalency_qa_research");

    const order = toCustomerOrder({
      order: orderRecord(stored),
      documents: [],
      confirmations: [],
      previewVersion: 1,
      paymentStatus: null,
      deliveryStatus: null,
      email: "ada@example.com",
    });
    const customerJson = JSON.stringify(order);
    assertCustomerCopy("customer order", customerJson);
    expect(order.evaluation?.kind).toBe("diploma");
    if (order.evaluation?.kind === "diploma") {
      expect(order.evaluation.credentials[0]?.usEquivalency).toBe("Bachelor's degree");
    }
    expect(order.reviewReason).toBeNull();
    expect(customerJson).not.toContain("edge_credential");
    expect(CONFIDENCE_LABEL.test(order.reviewReason ?? "")).toBe(false);

    const partner = toPartnerOrder({
      order: orderRecord(stored),
      paymentStatus: null,
      detail: true,
      qa: null,
    });
    assertCustomerCopy("partner order", JSON.stringify(partner));
    expect(partner.reviewReason).toBe("equivalency_qa_review");

    const received = renderOrderReceivedEmail({
      customerName: "Ada Lovelace",
      orderId: "order-1",
      sourceLanguage: "fr",
      targetLanguage: "en",
      documentCount: 1,
      pageCount: 1,
      estimatedCents: 1995,
      trackUrl: "https://www.credpronto.com/order/tok",
    });
    const preview = renderPreviewReadyEmail({
      orderId: "order-1",
      sourceLanguage: "fr",
      targetLanguage: "en",
      documentCount: 1,
      pageCount: 1,
      totalCents: 1995,
      payUrl: "https://www.credpronto.com/order/tok",
      includesTranslation: false,
    });
    const receipt = renderPaymentReceiptEmail({
      downloadUrl: null,
      receiptNumber: "CP-R-1",
      paidAt: "2026-10-12T00:00:00.000Z",
      paymentLabel: "Card",
      lines: [{ label: "Diploma evaluation", amountCents: 1995 }],
      totalCents: 1995,
    });
    assertCustomerCopy("order email", `${received.subject}\n${received.text}\n${received.html}`);
    assertCustomerCopy("preview email", `${preview.subject}\n${preview.text}\n${preview.html}`);
    assertCustomerCopy("receipt email", `${receipt.subject}\n${receipt.text}\n${receipt.html}`);

    const hook = webhookBody({
      id: "evt-1",
      type: "order.preview_ready",
      createdAt: "2026-10-12T00:00:00.000Z",
      orderId: "order-1",
      status: "preview_ready",
      externalRef: null,
    });
    assertCustomerCopy("webhook", hook);

    const files = await renderEvaluationPdfs({
      ...diploma,
      credentials: diploma.kind === "diploma"
        ? diploma.credentials.map((credential) => ({
            ...credential,
            usEquivalency: "Bachelor's degree",
          }))
        : [],
    });
    const { extractText, getDocumentProxy } = await import("unpdf");
    const proxy = await getDocumentProxy(files.preview.slice());
    const extracted = await extractText(proxy, { mergePages: true });
    const pdfText = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    assertCustomerCopy("pdf", pdfText);
    expect(pdfText).toContain("Bachelor's degree");
    expect(pdfText).not.toMatch(/\b(high|medium|low)\b/i);
  });
});
