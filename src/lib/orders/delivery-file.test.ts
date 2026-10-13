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
    expect(deliveryFileTarget({ ...shared, file: "certification" })).toBeNull();
    expect(deliveryFileTarget({ ...shared, file: "evaluation" })?.filename).not.toContain("EN-certified");
  });

  it("keeps the certified translation filename for a translation order", () => {
    expect(
      deliveryFileTarget({
        file: "translation",
        service: null,
        finalPath: "order-1/translation.pdf",
        certificationPath: "order-1/certificate.pdf",
        documentNames: ["birth-certificate.pdf"],
        targetLanguage: "en",
      })?.filename,
    ).toBe("birth-certificate-EN-certified.pdf");
  });
});
