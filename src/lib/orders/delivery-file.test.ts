import { describe, expect, it } from "vitest";
import { deliveryFileTarget } from "./delivery-file";

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
