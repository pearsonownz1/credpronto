import { describe, expect, it } from "vitest";
import { deliveryDocumentName, detectDocumentTitle, downloadFilename, orderDownloadFilename } from "./download-name";

describe("downloadFilename", () => {
  it("names a translation from the source stem and the target language code", () => {
    expect(downloadFilename("translation", "fr_diplome-licence.pdf", "en")).toBe(
      "fr_diplome-licence-EN-certified.pdf",
    );
    expect(downloadFilename("translation", "fr_diplome-licence.pdf", "pt")).toBe(
      "fr_diplome-licence-PT-certified.pdf",
    );
    expect(downloadFilename("translation", "fr_diplome-licence.pdf", "en-US")).toBe(
      "fr_diplome-licence-EN-certified.pdf",
    );
  });

  it("names the certification from the source stem", () => {
    expect(downloadFilename("certification", "fr_diplome-licence.pdf", "en")).toBe(
      "fr_diplome-licence-certificate.pdf",
    );
  });

  it("keeps the original document name when it is already safe ASCII", () => {
    expect(downloadFilename("original", "fr_diplome-licence.pdf")).toBe("fr_diplome-licence.pdf");
    expect(downloadFilename("original", "Scan.JPEG")).toBe("Scan.JPEG");
  });

  it("drops the directory and the last extension, and folds accents to ASCII", () => {
    expect(downloadFilename("translation", "C:\\docs\\fr_diplôme-licence.PDF", "en")).toBe(
      "fr_diplome-licence-EN-certified.pdf",
    );
    expect(downloadFilename("original", "../fr diplôme (licence).pdf")).toBe("fr_diplome_licence.pdf");
    expect(downloadFilename("certification", "file.name.pdf")).toBe("file.name-certificate.pdf");
  });

  it("uses document when the name has no safe ASCII stem", () => {
    for (const name of ["", "   ", "***", "学年证明.pdf", "???.pdf"]) {
      expect(downloadFilename("translation", name, "en")).toBe("document-EN-certified.pdf");
      expect(downloadFilename("certification", name)).toBe("document-certificate.pdf");
      expect(downloadFilename("original", name)).not.toContain("birth-certificate");
    }
    expect(downloadFilename("original", "学年证明.pdf")).toBe("document.pdf");
    expect(downloadFilename("original", "")).toBe("document");
    expect(downloadFilename("translation", "birth-certificate.pdf", "en")).toBe(
      "birth-certificate-EN-certified.pdf",
    );
  });

  it("names each document in a multi-document order from that document", () => {
    const names = ["fr_diplome-licence.pdf", "releve de notes.pdf"];
    expect(names.map((name) => downloadFilename("original", name))).toEqual([
      "fr_diplome-licence.pdf",
      "releve_de_notes.pdf",
    ]);
    expect(names.map((name) => downloadFilename("translation", name, "en"))).toEqual([
      "fr_diplome-licence-EN-certified.pdf",
      "releve_de_notes-EN-certified.pdf",
    ]);
    expect(JSON.stringify(names.map((name) => downloadFilename("certification", name)))).not.toContain(
      "birth-certificate",
    );
  });
});

describe("orderDownloadFilename", () => {
  it("uses the only document stem for an order-level PDF", () => {
    expect(orderDownloadFilename("translation", ["fr_diplome-licence.pdf"], "en")).toBe(
      "fr_diplome-licence-EN-certified.pdf",
    );
    expect(orderDownloadFilename("certification", ["fr_diplome-licence.pdf"], "en")).toBe(
      "fr_diplome-licence-certificate.pdf",
    );
    expect(orderDownloadFilename("evaluation", ["fr_diplome-licence.pdf"], "en")).toBe(
      "fr_diplome-licence-evaluation.pdf",
    );
  });

  it("joins each document stem for a multi-document order", () => {
    const names = ["fr_diplome-licence.pdf", "releve.pdf"];
    expect(orderDownloadFilename("translation", names, "en")).toBe(
      "fr_diplome-licence-releve-EN-certified.pdf",
    );
    expect(orderDownloadFilename("certification", names, "es")).toBe(
      "fr_diplome-licence-releve-certificate.pdf",
    );
    expect(orderDownloadFilename("translation", [], "en")).toBe("document-EN-certified.pdf");
    expect(orderDownloadFilename("translation", names, "en")).not.toContain("birth-certificate");
  });
});

describe("certified translation name", () => {
  it("slugifies a detected title and falls back to the upload base name", () => {
    expect(deliveryDocumentName({ detectedTitle: "Tax status letter", documentNames: ["scan.pdf"] })).toEqual({
      title: "Tax status letter",
      filename: "Tax-status-letter-certified-translation.pdf",
    });
    expect(deliveryDocumentName({ documentNames: ["birth-certificate.pdf"] })).toEqual({
      title: "Birth Certificate",
      filename: "birth-certificate-certified-translation.pdf",
    });
    expect(deliveryDocumentName({ documentNames: [] })).toEqual({
      title: "Document",
      filename: "document-certified-translation.pdf",
    });
  });

  it("reads a translated heading before a known source title", () => {
    expect(
      detectDocumentTitle({
        outputs: [{ pages: [{ blocks: [{ type: "heading", level: 1, text: "Tax status letter" }] }] }],
        ocrTexts: ["ACTA DE NACIMIENTO"],
      }),
    ).toBe("Tax status letter");
    expect(detectDocumentTitle({ ocrTexts: ["ACTA DE NACIMIENTO\nNombre"] })).toBe("Birth certificate");
    expect(detectDocumentTitle({ ocrTexts: ["not a title"] })).toBeNull();
  });
});
