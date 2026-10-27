import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pageSize } from "./layout";
import { renderOrderPdfs } from "./render";

describe("pageSize", () => {
  it("leaves Letter, A4, and the landscape license unchanged", () => {
    expect(pageSize({ widthPt: 612, heightPt: 792 })).toEqual({ widthPt: 612, heightPt: 792 });
    expect(pageSize({ widthPt: 792, heightPt: 612 })).toEqual({ widthPt: 792, heightPt: 612 });
    expect(pageSize({ widthPt: 595, heightPt: 842 })).toEqual({ widthPt: 595, heightPt: 842 });
    expect(pageSize({ widthPt: 500, heightPt: 700 })).toEqual({ widthPt: 500, heightPt: 700 });
    expect(pageSize({ widthPt: 200, heightPt: 400 })).toEqual({ widthPt: 200, heightPt: 400 });
    expect(pageSize({ widthPt: 0, heightPt: -1 })).toEqual({ widthPt: 612, heightPt: 792 });
  });

  it("scales an oversized A3 diploma scan into a Letter box without flipping it", () => {
    const sized = pageSize({ widthPt: 842, heightPt: 1190 });
    expect(Math.max(sized.widthPt, sized.heightPt)).toBeLessThanOrEqual(792);
    expect(Math.min(sized.widthPt, sized.heightPt)).toBeLessThanOrEqual(612);
    expect(sized.heightPt).toBeGreaterThan(sized.widthPt);
    expect(sized.heightPt / sized.widthPt).toBeCloseTo(1190 / 842, 2);
    expect(sized.heightPt).toBeGreaterThan(780);

    const landscape = pageSize({ widthPt: 1190, heightPt: 842 });
    expect(landscape.widthPt).toBeGreaterThan(landscape.heightPt);
    expect(Math.max(landscape.widthPt, landscape.heightPt)).toBeLessThanOrEqual(792);
    expect(Math.min(landscape.widthPt, landscape.heightPt)).toBeLessThanOrEqual(612);
  });

  it("renders the diploma translation on the scaled page", async () => {
    const rendered = await renderOrderPdfs({
      orderId: "2485f011-d813-414f-b784-72254ff77e8b",
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-27",
      clientName: "Judit Giménez Roig",
      documents: [{ name: "Diploma", sourcePages: 1, translatedPages: 1 }],
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 842,
          heightPt: 1190,
          kind: "certificate",
          paragraphs: [],
          blocks: [
            { type: "heading", text: "Graduate in Biotechnology", align: "center", bold: true },
            { type: "paragraph", text: "Universitat Autònoma de Barcelona", align: "center" },
            {
              type: "table",
              header: true,
              rows: [
                ["Alphanumeric code", "National register", "Center code", "University register", "University file No."],
                ["022A-084542", "2020/217459", "08071020", "227295", "14655910H5051"],
              ],
            },
            { type: "signature", electronic: false, lines: ["Judit Giménez Roig", "The holder"] },
            { type: "signature", electronic: false, lines: ["Margarita Arboix Arzo", "The Rector"] },
            { type: "signature", electronic: false, lines: ["Joaquín Bernabé Ródenas", "Head of Academic Affairs"] },
          ],
        },
      ],
    });
    const doc = await PDFDocument.load(rendered.watermarkedPreview);
    expect(doc.getPageCount()).toBe(1);
    const size = doc.getPage(0).getSize();
    expect(size.height).toBeLessThanOrEqual(792);
    expect(size.width).toBeLessThanOrEqual(612);
    expect(size.height).toBeGreaterThan(size.width);
  });
});
