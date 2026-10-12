import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { COVER_ADDRESS } from "./cover";
import { SAMPLE_COVER_INPUT } from "./cover-sample";
import { renderCertificationPdf } from "./render";

describe("homepage cover sample", () => {
  it("renders the certification template with example data", async () => {
    const pdf = await renderCertificationPdf(SAMPLE_COVER_INPUT);
    const proxy = await getDocumentProxy(new Uint8Array(pdf));
    const extracted = await extractText(proxy, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toContain("Alex Example");
    expect(text).toContain("EXAMPLE-000");
    expect(text).toContain("example-birth-certificate.pdf");
    expect(text).toContain("CredPronto Certification Team");
    expect(text).not.toContain("Example Translator");
    expect(text).toContain(COVER_ADDRESS.split(",")[0]);
    expect(text).toContain("2520 Venture Oaks Way");
    expect(text.toLowerCase()).not.toContain("uscis");
    expect(text.toLowerCase()).not.toContain("accepted");
  });

  it("publishes a png of that cover", async () => {
    const png = readFileSync(path.join(process.cwd(), "public/samples/cover-cert-sample.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const meta = await sharp(png).metadata();
    expect(meta.width).toBeGreaterThan(700);
    expect(meta.height).toBeGreaterThan(meta.width ?? 0);
  });
});
