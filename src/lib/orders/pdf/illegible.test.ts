import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { RenderBlock } from "./layout";
import { renderOrderPdfs } from "./render";
import { blocksFromModel, blocksToParagraphs, cleanIllegibleBlocks, stripIllegibleMarkup } from "./structure";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const extracted = await extractText(pdf, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

describe("illegible markup", () => {
  it("keeps the printed words around a false tag", () => {
    expect(stripIllegibleMarkup("Prof. [illegible] Torres da Silva")).toBe("Prof. Torres da Silva");
    expect(stripIllegibleMarkup("Prof. [ILLEGIBLE] Torres da Silva")).toBe("Prof. Torres da Silva");
    expect(stripIllegibleMarkup("Prof. (illegible) Torres da Silva")).toBe("Prof. Torres da Silva");
    expect(stripIllegibleMarkup("Prof. (ILLEGIBLE) Torres da Silva")).toBe("Prof. Torres da Silva");
    expect(stripIllegibleMarkup("Civil ILLEGIBLE Law")).toBe("Civil Law");
    expect(stripIllegibleMarkup("**Prof. [illegible] Torres**")).toBe("**Prof. Torres**");
    expect(stripIllegibleMarkup("Hello, [illegible], world")).toBe("Hello, world");
    expect(stripIllegibleMarkup("Grade: [illegible]")).toBe("Grade:");
    expect(stripIllegibleMarkup("[illegible]")).toBe("");
    expect(stripIllegibleMarkup("[illegible seal]")).toBe("[illegible seal]");
    expect(stripIllegibleMarkup("U.S.A. [illegible] office")).toBe("U.S.A. office");
    expect(stripIllegibleMarkup("13.20")).toBe("13.20");
  });

  it("drops illegible blocks and cleans cells, fields, and signature lines", () => {
    const blocks = blocksFromModel({
      blocks: [
        { type: "paragraph", text: "Prof. [illegible] Torres da Silva" },
        { type: "illegible" },
        { type: "heading", text: "[ILLEGIBLE]" },
        { type: "table", cells: [["Course", "Civil [illegible] Law"], ["Grade", "(illegible)"]] },
        { type: "fields", rows: [{ label: "Dean", value: "Prof. [illegible] Torres da Silva" }] },
        { type: "signature", electronic: false, lines: ["Prof. [illegible] Torres da Silva", "[illegible]"] },
        { type: "stamp", text: "[illegible]" },
        { type: "handwritten", text: "(illegible)" },
      ],
    });
    expect(blocks.some((block) => block.type === "illegible")).toBe(false);
    expect(blocks.find((block) => block.type === "paragraph")).toMatchObject({ text: "Prof. Torres da Silva" });
    expect(blocks.find((block) => block.type === "heading")).toBeUndefined();
    const table = blocks.find((block) => block.type === "table");
    expect(table).toMatchObject({ rows: [["Course", "Civil Law"], ["Grade", ""]] });
    expect(blocks.find((block) => block.type === "fields")).toMatchObject({
      rows: [{ label: "Dean", value: "Prof. Torres da Silva" }],
    });
    const signs = blocks.filter((block) => block.type === "signature");
    expect(signs[0]).toMatchObject({ lines: ["Prof. Torres da Silva"] });
    expect(signs[1]).toMatchObject({ electronic: false });
    expect(signs[1]).not.toHaveProperty("lines");
    expect(blocks.find((block) => block.type === "stamp")).toMatchObject({ text: "" });

    const prose = blocksToParagraphs([
      { type: "illegible" },
      { type: "paragraph", text: "Prof. [illegible] Torres da Silva" },
      { type: "signature", electronic: false, lines: ["[ILLEGIBLE]"] },
      { type: "stamp", text: "(illegible)" },
    ]).join("\n");
    expect(prose).not.toMatch(/illegible/i);
    expect(prose).toContain("Prof. Torres da Silva");
    expect(prose).toContain("[Signature]");
    expect(prose).toContain("[Stamp]");
  });

  it("leaves a clean block unchanged", () => {
    const blocks: RenderBlock[] = [{ type: "paragraph", text: "Civil Law" }];
    expect(cleanIllegibleBlocks(blocks)[0]).toBe(blocks[0]);
  });
});

describe("certified pages", () => {
  it("does not draw ILLEGIBLE on a form or a certificate", async () => {
    const noisy: RenderBlock[] = [
      { type: "paragraph", text: "Prof. [illegible] Torres da Silva" },
      { type: "illegible" },
      { type: "fields", rows: [{ label: "Course", value: "Intro to [ILLEGIBLE] Law" }, { label: "Grade", value: "(illegible)" }] },
      { type: "table", rows: [["Subject", "Hours"], ["Civil [illegible] Law", "60"]], header: true },
      { type: "stamp", text: "[illegible]" },
      { type: "signature", electronic: false, lines: ["Prof. [illegible] Torres da Silva", "Dean"] },
      { type: "handwritten", text: "(illegible)" },
    ];
    const rendered = await renderOrderPdfs({
      orderId: "order-tags",
      sourceLanguage: "pt",
      targetLanguage: "en",
      date: "2026-10-28",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "form",
          paragraphs: ["Prof. [illegible] Torres da Silva", "[ILLEGIBLE]"],
          blocks: noisy,
        },
        {
          combinedPageNumber: 2,
          widthPt: 612,
          heightPt: 792,
          kind: "certificate",
          paragraphs: [],
          blocks: noisy,
        },
        {
          combinedPageNumber: 3,
          widthPt: 612,
          heightPt: 792,
          kind: "form",
          paragraphs: ["Prof. [illegible] Torres da Silva", "Grade: (ILLEGIBLE)"],
        },
      ],
    });

    const drawn = rendered.pageTexts.map((page) => page.text).join("\n");
    expect(drawn).toContain("Torres");
    expect(drawn).toContain("Silva");
    expect(drawn).toContain("Civil");
    expect(drawn).toContain("Law");
    expect(drawn).toContain("[Signature]");
    expect(drawn).not.toMatch(/illegible/i);

    const clean = await pdfText(rendered.cleanTranslation);
    expect(clean).toContain("Torres");
    expect(clean).not.toMatch(/illegible/i);
  });
});
