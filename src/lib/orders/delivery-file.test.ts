import { describe, expect, it } from "vitest";
import { bundleTranslationFile, deliveryFileTarget } from "./delivery-file";
import { bundleTranslationReady } from "./final-file";

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
    expect(
      bundleTranslationReady({
        includeTranslation: true,
        status: "paid",
        paymentStatus: "paid",
        finalTranslationPath: translation,
      }),
    ).toBe(true);
    expect(
      bundleTranslationReady({
        includeTranslation: true,
        status: "preview_ready",
        paymentStatus: null,
        finalTranslationPath: translation,
      }),
    ).toBe(false);
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
