import { describe, expect, it } from "vitest";
import { bundleTranslationFile, deliveryFileTarget } from "./delivery-file";
import { EVALUATION_REVIEW_REASON } from "./evaluation-price";
import { bundleTranslationDecision, bundleTranslationReady, type BundleTranslationInput } from "./final-file";
import { QA_REVIEW_REASON } from "./qa";
import { HIGH_QA_SCORE } from "./release-decision";

const report = "order-1/evaluation-v1.pdf";

describe("evaluation download", () => {
  it("serves the report under an evaluation name and skips a certificate that is the same file", () => {
    const shared = {
      service: "diploma" as const,
      finalPath: report,
      certificationPath: report,
      documentNames: ["birth-certificate.pdf"],
      targetLanguage: "en",
    };
    expect(deliveryFileTarget({ ...shared, file: "evaluation" })).toEqual({
      path: report,
      filename: "birth-certificate-evaluation.pdf",
    });
    expect(deliveryFileTarget({ ...shared, file: "translation" })).toBeNull();
    expect(deliveryFileTarget({ ...shared, file: "certification" })).toEqual({
      path: report,
      filename: "birth-certificate-evaluation.pdf",
    });
    expect(deliveryFileTarget({ ...shared, file: "evaluation" })?.filename).not.toContain("EN-certified");
  });

  it("serves the certified translation for a paid bundle and keeps the evaluation report separate", () => {
    const translation = "order-1/certified-translation-v1.pdf";
    const report = "order-1/evaluation.pdf";
    expect(
      bundleTranslationFile({
        includeTranslation: true,
        file: "translation",
        translationPath: translation,
        documentNames: ["diploma.pdf"],
        targetLanguage: "en",
      }),
    ).toEqual({ path: translation, filename: "diploma-certified-translation.pdf" });
    expect(
      bundleTranslationFile({
        includeTranslation: true,
        file: "evaluation",
        translationPath: translation,
        documentNames: ["diploma.pdf"],
        targetLanguage: "en",
      }),
    ).toBeNull();
    expect(
      bundleTranslationFile({
        includeTranslation: false,
        file: "translation",
        translationPath: translation,
        documentNames: ["diploma.pdf"],
        targetLanguage: "en",
      }),
    ).toBeNull();
    expect(
      deliveryFileTarget({
        file: "translation",
        service: "diploma",
        includeTranslation: true,
        finalPath: translation,
        certificationPath: translation,
        documentNames: ["diploma.pdf"],
        targetLanguage: "en",
      })?.path,
    ).toBe(translation);
    expect(
      deliveryFileTarget({
        file: "evaluation",
        service: "diploma",
        includeTranslation: true,
        finalPath: report,
        certificationPath: report,
        documentNames: ["diploma.pdf"],
        targetLanguage: "en",
      })?.filename,
    ).toBe("diploma-evaluation.pdf");
    const clean: BundleTranslationInput = {
      includeTranslation: true,
      status: "paid",
      paymentStatus: "paid",
      finalTranslationPath: translation,
      certificationPath: translation,
      reviewReason: EVALUATION_REVIEW_REASON,
      qa: { status: "pass", score: HIGH_QA_SCORE },
      languageConfidence: 0.96,
      pageNeedsReview: false,
      openCorrections: false,
      enabled: true,
      deliveryStatus: "pending",
      deliveryFinalPath: null,
    };
    expect(bundleTranslationReady(clean)).toBe(true);
    expect(bundleTranslationDecision(clean)).toEqual({ ok: true });
    expect(
      bundleTranslationReady({
        ...clean,
        status: "preview_ready",
        paymentStatus: null,
      }),
    ).toBe(false);
    expect(
      bundleTranslationDecision({
        ...clean,
        status: "preview_ready",
        paymentStatus: null,
      }),
    ).toEqual({ ok: false, status: 402, error: "Payment required" });
  });

  it("keeps a paid flagged bundle locked until staff approve the translation", () => {
    const translation = "order-1/certified-translation-v1.pdf";
    const flagged: BundleTranslationInput = {
      includeTranslation: true,
      status: "paid",
      paymentStatus: "paid",
      finalTranslationPath: translation,
      certificationPath: translation,
      reviewReason: QA_REVIEW_REASON,
      qa: { status: "fail", score: 40 },
      languageConfidence: 0.96,
      pageNeedsReview: false,
      openCorrections: false,
      enabled: true,
      deliveryStatus: "pending",
      deliveryFinalPath: null,
    };
    expect(bundleTranslationReady(flagged)).toBe(false);
    expect(bundleTranslationDecision(flagged)).toEqual({
      ok: false,
      status: 403,
      error: "Certification is not approved",
    });
    expect(
      bundleTranslationReady({
        ...flagged,
        reviewReason: EVALUATION_REVIEW_REASON,
        qa: { status: "pass", score: HIGH_QA_SCORE - 1 },
      }),
    ).toBe(false);
    expect(
      bundleTranslationReady({
        ...flagged,
        status: "delivered",
        deliveryStatus: "delivered",
        deliveryFinalPath: "order-1/evaluation.pdf",
      }),
    ).toBe(false);
    expect(
      bundleTranslationReady({
        ...flagged,
        deliveryStatus: "approved",
        deliveryFinalPath: translation,
      }),
    ).toBe(true);
  });

  it("names one certified translation and serves the certificate link from that file", () => {
    const shared = {
      service: null,
      finalPath: "order-1/translation.pdf",
      certificationPath: "order-1/certificate.pdf",
      documentNames: ["birth-certificate.pdf"],
      targetLanguage: "en",
    };
    expect(deliveryFileTarget({ ...shared, file: "translation" })).toEqual({
      path: "order-1/translation.pdf",
      filename: "birth-certificate-certified-translation.pdf",
    });
    expect(deliveryFileTarget({ ...shared, file: "certification" })).toEqual({
      path: "order-1/translation.pdf",
      filename: "birth-certificate-certified-translation.pdf",
    });
    expect(
      deliveryFileTarget({ ...shared, file: "translation", detectedTitle: "Tax status letter" })?.filename,
    ).toBe("Tax-status-letter-certified-translation.pdf");
  });
});
