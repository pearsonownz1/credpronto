import { inflateSync } from "node:zlib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { PRE_EVAL_PREVIEW_LABEL, preEvaluationPreviewObjectPath, renderWatermarkedPreview } from "./watermark";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function pdfText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes.slice());
  const extracted = await extractText(proxy, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

function pdfOperators(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  let out = "";
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf("stream", cursor);
    if (start < 0) break;
    let dataStart = start + "stream".length;
    if (raw[dataStart] === 0x0d) dataStart += 1;
    if (raw[dataStart] === 0x0a) dataStart += 1;
    const end = raw.indexOf("endstream", dataStart);
    if (end < 0) break;
    try {
      out += inflateSync(raw.subarray(dataStart, end)).toString("latin1");
    } catch {
      out += raw.subarray(dataStart, end).toString("latin1");
    }
    cursor = end + "endstream".length;
  }
  return out;
}

describe("pre-evaluation watermark", () => {
  it("stamps a pdf without returning the original bytes", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage();
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("ORIGINAL-ONLY", { x: 72, y: 720, size: 18, font });
    const original = await source.save();

    const rendered = await renderWatermarkedPreview(original, "application/pdf");
    expect(Buffer.compare(Buffer.from(rendered), Buffer.from(original))).not.toBe(0);
    expect(Buffer.from(rendered.subarray(0, 4)).toString()).toBe("%PDF");
    const text = await pdfText(rendered);
    expect(text).toContain(PRE_EVAL_PREVIEW_LABEL);
    expect(text).toContain("ORIGINAL-ONLY");
    const operators = pdfOperators(rendered);
    expect(operators).toContain("0.8660254037844387 -0.49999999999999994");
    expect(operators).toContain("0.043137254901960784 0.12156862745098039 0.22745098039215686 rg");
    expect(operators).toContain("0 0 m");
    expect(operators).toContain("0 36 l");
    expect(preEvaluationPreviewObjectPath("abc")).toBe("abc/renders/preview.pdf");
    expect(preEvaluationPreviewObjectPath("abc")).not.toBe("abc/credential.pdf");
  });

  it("wraps an image in a watermarked pdf instead of returning the image", async () => {
    const original = new Uint8Array(PNG);
    const rendered = await renderWatermarkedPreview(original, "image/png");
    expect(Buffer.compare(Buffer.from(rendered), Buffer.from(original))).not.toBe(0);
    expect(rendered[0]).toBe(0x25);
    expect(original[0]).toBe(0x89);
    expect(await pdfText(rendered)).toContain(PRE_EVAL_PREVIEW_LABEL);
  });
});
