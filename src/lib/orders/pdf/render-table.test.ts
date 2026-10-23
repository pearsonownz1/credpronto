import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { tableColumnWidths } from "./document-layout";
import type { RenderBlock } from "./layout";
import { renderOrderPdfs } from "./render";
import { finalizeBlocks } from "./structure";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const grades: string[][] = [
  ["SUBJECTS", "COEF.", "Grade x Coef"],
  ["Economic and Legal Sciences", "4.0", "38"],
  ["French", "3.0", "34"],
  ["Philosophy", "2.0", "20"],
  ["A subject with a very long name that has to wrap inside its narrow cell on the page", "2.0", "17"],
  ["GRAND TOTAL", "30.0", "300"],
];

const cells = grades.flat();

async function render(blocks: RenderBlock[], widthPt = 595, heightPt = 842) {
  return renderOrderPdfs({
    orderId: "order-table",
    sourceLanguage: "fr",
    date: "2026-10-23",
    pages: [{ combinedPageNumber: 1, widthPt, heightPt, paragraphs: [], blocks }],
  });
}

describe("table blocks", () => {
  it("keeps string-array rows when stored blocks are finalized again", () => {
    const [block] = finalizeBlocks([{ type: "table", rows: grades }]);
    expect(block).toMatchObject({ type: "table", rows: grades });
  });

  it.each([
    ["plain page", [{ type: "table", rows: grades }] as RenderBlock[]],
    ["form page", [{ type: "kv", label: "Name", value: "KOUAMOU" }, { type: "table", rows: grades }] as RenderBlock[]],
  ])("prints every cell in the preview and the clean final (%s)", async (_name, blocks) => {
    const rendered = await render(blocks);
    for (const bytes of [rendered.watermarkedPreview, rendered.cleanTranslation]) {
      const text = (await pdfText(bytes)).replace(/\s+/g, " ");
      for (const cell of cells) {
        for (const word of cell.split(" ")) expect(text).toContain(word);
      }
    }
  });

  it("fits columns into the available width", () => {
    const widths = tableColumnWidths([400, 40, 60], 300);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(300);
    expect(widths[1]).toBe(40);
    expect(widths[2]).toBe(60);
    const roomy = tableColumnWidths([50, 40], 300);
    expect(roomy.reduce((sum, width) => sum + width, 0)).toBeCloseTo(300);
  });
});
