import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PREVIEW_WATERMARK, PREVIEW_WATERMARK_OPACITY, previewWatermarkRgb } from "../constants";
import { buildCombinedOriginal } from "./combine";
import { faceForCodePoint } from "./font";
import { translationRenderPasses, wrapLines } from "./layout";
import { CERTIFICATION_STATEMENTS } from "./cover";
import { renderOrderPdfs } from "./render";
import { collapseLetterSpacing, structurePage, structurePositioned, type TextItem } from "./structure";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: string[]; pageCount: number }> {
  const proxy = await getDocumentProxy(copyBytes(bytes));
  const extracted = await extractText(proxy, { mergePages: false });
  return { text: extracted.text.join("\n"), pages: extracted.text, pageCount: extracted.totalPages };
}

describe("translated pdf renders", () => {
  it("bakes the watermark into a separate preview and leaves it off the clean file", async () => {
    const passes = translationRenderPasses();
    expect(passes[1]).toMatchObject({
      watermark: true,
      includeCertification: false,
      bucket: "previews",
    });
    expect(passes[0].bucket).toBe("finals");
    expect(passes[0].watermark).toBe(false);
    expect(passes[0].includeCertification).toBe(true);

    const rendered = await renderOrderPdfs({
      orderId: "order-1",
      sourceLanguage: "es",
      date: "2026-10-12",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: ["Hello diploma"],
        },
      ],
    });

    expect(rendered.watermarkedPreview).not.toEqual(rendered.cleanTranslation);

    const preview = await pdfText(rendered.watermarkedPreview);
    const clean = await pdfText(rendered.cleanTranslation);
    const certification = await pdfText(rendered.certification);

    expect(preview.pageCount).toBe(1);
    expect(clean.pageCount).toBe(2);
    expect(preview.text).toContain("Hello diploma");
    expect(PREVIEW_WATERMARK).toBe("PREVIEW · CREDPRONTO · NOT FOR OFFICIAL USE");
    expect(PREVIEW_WATERMARK_OPACITY).toBeCloseTo(0.16);
    expect(previewWatermarkRgb()).toEqual({ r: 0x1f / 255, g: 0x5e / 255, b: 0xff / 255 });
    expect(preview.text).toContain(PREVIEW_WATERMARK);
    expect(preview.text).not.toContain("Certificate of Translation Accuracy");
    expect(preview.text).not.toContain("2520 Venture Oaks Way");
    expect(clean.text).toContain("Hello diploma");
    expect(clean.text).toContain("Certificate of Translation Accuracy");
    expect(clean.pages[0]).toContain("2520 Venture Oaks Way");
    expect(clean.pages[0]).toContain("Sacramento, CA 95833");
    expect(clean.pages[1]).not.toContain("2520 Venture Oaks Way");
    expect(clean.pages[1]).toContain("Page 2 of 2");
    expect(clean.pages[1]).toContain("order-1");
    expect(clean.text).not.toContain("PREVIEW");
    expect(certification.text).toContain("Certificate of Translation Accuracy");
    const certificationText = certification.text.replace(/\s+/g, " ");
    expect(certificationText).toContain(CERTIFICATION_STATEMENTS[0]);
    expect(certificationText).toContain(CERTIFICATION_STATEMENTS[1]);
    expect(certificationText).toContain("Certified Translator");
    expect(certificationText).toContain("Date");
    expect(certificationText).not.toContain("CredPronto Certification Team");
    expect(certificationText).toContain(
      "CredPronto · credpronto.com · 2520 Venture Oaks Way, Suite 120, Sacramento, CA 95833",
    );
    expect(certificationText).not.toContain("Intended use");
    expect(certification.text).toContain("order-1");
    expect(certification.text).toContain("Page 1 of 2");
    expect(certification.text).toContain("Order order-1 · Page 1 of 2");
  });
});

const FIXTURE = path.join(process.cwd(), "src/lib/orders/pdf/fixtures/es-mx-acta-nacimiento.pdf");
const SIGNATURE =
  "SAMPLExQ2FyZ29zIGZpY3RpY2lvcyBwYXJhIHBydWViYXMgZGUgQ3JlZFByb250bw0KTm8gZXMgdW4gZG9jdW1lbnRvIHJlYWwgbmkgdmFsaWRvIHBhcmEgdHJhbWl0ZXMgb2ZpY2lhbGVz/AbCdEf0123+SAMPLE==";

async function pdfItems(bytes: Uint8Array) {
  const doc = await PDFDocument.load(copyBytes(bytes));
  const extracted = await extractTextItems(copyBytes(bytes));
  return extracted.items.map((pageItems, index) => {
    const size = doc.getPage(index).getSize();
    return {
      width: size.width,
      height: size.height,
      items: pageItems.map((item) => ({
        str: item.str,
        x: item.x,
        y: item.y,
        width: item.width,
        rotated: false,
      })),
    };
  });
}

function assertWithinPage(pages: Awaited<ReturnType<typeof pdfItems>>) {
  for (const page of pages) {
    for (const item of page.items) {
      if (!item.str.trim() || item.rotated) continue;
      const fragment = item.str.trim();
      if (fragment.length >= 4 && PREVIEW_WATERMARK.includes(fragment)) continue;
      expect(item.x, item.str).toBeGreaterThanOrEqual(-0.75);
      expect(item.x + item.width, item.str).toBeLessThanOrEqual(page.width + 0.75);
    }
  }
}

async function italicAngles(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(copyBytes(bytes));
  const angles: number[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const record = object as { entries?: () => Iterable<[unknown, { asNumber?: () => number }]> };
    if (typeof record.entries !== "function") continue;
    for (const [key, value] of record.entries()) {
      if (String(key) !== "/ItalicAngle" || typeof value.asNumber !== "function") continue;
      angles.push(value.asNumber());
    }
  }
  return angles;
}

function assertNoNotdef(text: string) {
  expect(text).not.toContain("\u0000");
  expect(text).not.toContain("\uFFFD");
  for (const char of Array.from(text)) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 32 || !char.trim()) continue;
    const face = faceForCodePoint(codePoint, false) ?? faceForCodePoint(codePoint, true);
    expect(face, `U+${codePoint.toString(16)} ${char}`).toBeTruthy();
  }
}

function decodeUtf16be(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  let out = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    out += String.fromCharCode(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
  }
  return out;
}

function unicodeMap(cmap: string): Map<string, number> {
  const mapped = new Map<string, number>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const match of (block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const char = decodeUtf16be(match[2] ?? "");
      if (char) mapped.set(char, Number.parseInt(match[1] ?? "", 16));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const match of (block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = Number.parseInt(match[1] ?? "", 16);
      const end = Number.parseInt(match[2] ?? "", 16);
      const first = decodeUtf16be(match[3] ?? "").codePointAt(0);
      if (first == null || end < start || end - start > 512) continue;
      for (let cid = start; cid <= end; cid += 1) mapped.set(String.fromCodePoint(first + cid - start), cid);
    }
  }
  return mapped;
}

function decodedStream(object: object): Uint8Array | null {
  const stream = object as { getContents?: () => Uint8Array };
  if (typeof stream.getContents !== "function") return null;
  const raw = stream.getContents();
  if (raw[0] === 0x78) {
    try {
      return inflateSync(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

async function expectGlyphOutlines(pdf: Uint8Array, chars: string[]) {
  const doc = await PDFDocument.load(copyBytes(pdf));
  const programs: Uint8Array[] = [];
  const maps: Map<string, number>[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const data = decodedStream(object);
    if (!data) continue;
    const header = Buffer.from(data.subarray(0, 4)).toString("latin1");
    if (header === "true" || header === "OTTO") programs.push(data);
    const text = Buffer.from(data).toString("latin1");
    if (text.includes("beginbfchar") || text.includes("beginbfrange")) maps.push(unicodeMap(text));
  }
  for (const char of chars) {
    const cid = maps.map((entry) => entry.get(char)).find((value) => value != null);
    expect(cid, char).toEqual(expect.any(Number));
    const outlines = programs.map((program) => {
      try {
        const font = fontkit.create(program) as { getGlyph(id: number): { path?: { commands?: unknown[] } } };
        return font.getGlyph(cid ?? 0).path?.commands?.length ?? 0;
      } catch {
        return 0;
      }
    });
    expect(Math.max(...outlines), char).toBeGreaterThan(0);
  }
}

async function pageItems(file: string): Promise<TextItem[][]> {
  const bytes = new Uint8Array(readFileSync(path.join(process.cwd(), file)));
  const extracted = await extractTextItems(bytes);
  return extracted.items.map((page) =>
    page.flatMap((item) => {
      if (!item.str.trim()) return [];
      return [{ text: item.str, x: item.x, y: item.y, width: item.width, size: item.fontSize }];
    }),
  );
}

async function loadItems(file: string): Promise<TextItem[]> {
  return (await pageItems(file))[0] ?? [];
}

async function loadAllPages(file: string): Promise<TextItem[][]> {
  return pageItems(file);
}

async function fixtureItems(): Promise<TextItem[]> {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const extracted = await extractTextItems(bytes);
  return (extracted.items[0] ?? []).flatMap((item) => {
    if (!item.str.trim()) return [];
    return [{ text: item.str, x: item.x, y: item.y, width: item.width, size: item.fontSize }];
  });
}

describe("form translation layout", () => {
  it("breaks long tokens on punctuation and keeps dates whole", () => {
    const widthOf = (line: string) => line.length * 10;
    const wrapped = wrapLines(SIGNATURE, widthOf, 80);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) expect(widthOf(line)).toBeLessThanOrEqual(80);

    const original = "||01482|0003|19/09/1996|SAMPLE-NO-VALIDO||";
    const lines = wrapLines(original, (line) => line.length * 6, 72);
    expect(lines.join("")).toBe(original);
    expect(lines.some((line) => line.includes("19/09/1996"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toMatch(/(^|\D)9\/09\/1996/);
      expect(line).not.toMatch(/19\/09\/199$/);
    }

    expect(collapseLetterSpacing("C I V I L  R E G I S T R Y")).toBe("CIVIL REGISTRY");
    const runOn = structurePage("FIRST NAME(S) VALERIA XIMENA FIRST SURNAME OLVERA SECOND SURNAME TOSTADO");
    const rows = runOn.flatMap((block) => (block.type === "fields" ? block.rows : []));
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["First name(s)", "VALERIA XIMENA"],
      ["First surname", "OLVERA"],
      ["Second surname", "TOSTADO"],
    ]);
  });

  it("renders the birth-certificate fixture inside the page with no missing glyphs", async () => {
    const blocks = structurePositioned(await fixtureItems());
    const rendered = await renderOrderPdfs({
      orderId: "acta-sample",
      sourceLanguage: "es",
      date: "2026-10-12",
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: [], blocks }],
    });

    const previewText = await pdfText(rendered.watermarkedPreview);
    const cleanText = await pdfText(rendered.cleanTranslation);
    const previewPages = await pdfItems(rendered.watermarkedPreview);
    const cleanPages = await pdfItems(rendered.cleanTranslation);

    expect(previewText.text).toContain("[SEAL]");
    expect(previewText.text).toContain("Civil Registry of Jalisco");
    expect(previewText.text).toContain("[Electronic signature]");
    expect(previewText.text).toContain("First name(s)");
    expect(previewText.text).toContain("VALERIA XIMENA");
    expect(previewText.text).toContain("ÍÑIGUEZ");
    expect(previewText.text).toContain("TREVIÑO");
    expect(previewText.text).toContain("March 14, 2024");
    expect(previewText.text).not.toContain(SIGNATURE.slice(0, 40));
    expect(previewText.text).not.toMatch(/C\s+I\s+V\s+I\s+L/);
    expect(previewText.text).not.toContain("OFICIALÍA 0007");
    expect(cleanText.text).not.toContain("PREVIEW");
    expect(previewText.text).toContain(PREVIEW_WATERMARK);

    assertWithinPage(previewPages);
    assertWithinPage(cleanPages);
    assertNoNotdef(previewText.text);
    assertNoNotdef(cleanText.text);
    expect((await italicAngles(rendered.watermarkedPreview)).some((angle) => angle !== 0)).toBe(true);

    const label = previewPages[0]?.items.find((item) => item.str.includes("First name(s)"));
    const value = previewPages[0]?.items.find((item) => item.str.includes("VALERIA"));
    expect(label).toBeTruthy();
    expect(value).toBeTruthy();
    expect(value!.x).toBeGreaterThan(label!.x + 20);
    expect(Math.abs(value!.y - label!.y)).toBeLessThan(2);
  });

  it("renders a CJK name with a per-glyph fallback and no .notdef glyphs", async () => {
    const rendered = await renderOrderPdfs({
      orderId: "diploma-zh",
      sourceLanguage: "zh",
      date: "2026-10-12",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: [],
          blocks: [
            { type: "heading", text: "Diploma", level: 1 },
            {
              type: "fields",
              rows: [
                { label: "Student", value: "张伟 Zhang Wei" },
                { label: "Also", value: "佐藤 김민준" },
              ],
            },
            { type: "paragraph", text: "Awarded with distinction." },
          ],
        },
      ],
    });

    const clean = await pdfText(rendered.cleanTranslation);
    expect(clean.text).toContain("张伟");
    expect(clean.text).toContain("佐藤");
    expect(clean.text).toContain("김민준");
    assertNoNotdef(clean.text);
    assertWithinPage(await pdfItems(rendered.cleanTranslation));
    expect(faceForCodePoint("张".codePointAt(0) ?? 0)?.id).toBe("cjk-sc");
    expect(faceForCodePoint("김".codePointAt(0) ?? 0)?.id).toBe("cjk-kr");
    await expectGlyphOutlines(rendered.cleanTranslation, ["张", "伟", "佐", "藤", "김", "민", "준"]);
  });

  it("embeds an outline for every drawn glyph of 林志恒 and 陈", async () => {
    const rendered = await renderOrderPdfs({
      orderId: "cjk-names",
      sourceLanguage: "zh",
      date: "2026-10-12",
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: [],
          blocks: [
            { type: "fields", rows: [{ label: "Student", value: "陈浩宇" }, { label: "Father", value: "林志恒" }] },
          ],
        },
      ],
    });
    const text = await pdfText(rendered.cleanTranslation);
    expect(text.text).toContain("陈浩宇");
    expect(text.text).toContain("林志恒");
    await expectGlyphOutlines(rendered.cleanTranslation, ["林", "志", "恒", "陈"]);
  });

  it("keeps CJK names in the embedded font for the Chinese fixtures", async () => {
    const birthItems = await loadItems("src/lib/orders/__fixtures__/zh_chusheng-yixue-zhengming.pdf");
    const birthBlocks = structurePositioned(birthItems);
    const birth = await renderOrderPdfs({
      orderId: "zh-birth",
      sourceLanguage: "zh",
      date: "2026-10-12",
      pages: [{ combinedPageNumber: 1, widthPt: 612, heightPt: 792, paragraphs: [], blocks: birthBlocks }],
    });
    const birthText = await pdfText(birth.watermarkedPreview);
    const birthPages = await pdfItems(birth.watermarkedPreview);
    expect(birthText.text.match(/Medical certificate of birth/g)).toHaveLength(1);
    expect(birthText.text).toContain("No.");
    expect(birthText.text).toContain("Place of birth");
    expect(birthText.text).toContain("林志恒");
    expect(birthText.text).toContain("林晓萱");
    assertWithinPage(birthPages);
    assertNoNotdef(birthText.text);

    const title = birthPages[0]?.items.find((item) => item.str.includes("Medical certificate of birth"));
    const number = birthPages[0]?.items.find((item) => item.str.includes("No."));
    const place = birthPages[0]?.items.find((item) => item.str.includes("Place of birth"));
    const placeValue = birthPages[0]?.items.find((item) => item.str.includes("云川") || item.str.includes("南湖"));
    expect(title && number && place && placeValue).toBeTruthy();
    expect(title!.y).toBeGreaterThan(number!.y);
    expect(placeValue!.x).toBeGreaterThan(place!.x + 20);
    expect(Math.abs(placeValue!.y - place!.y)).toBeLessThan(2);
    await expectGlyphOutlines(birth.cleanTranslation, ["林", "志", "恒"]);

    const diplomaPages = await loadAllPages("src/lib/orders/__fixtures__/zh_chengjidan_2p.pdf");
    const diploma = await renderOrderPdfs({
      orderId: "zh-diploma",
      sourceLanguage: "zh",
      date: "2026-10-12",
      pages: diplomaPages.map((items, index) => ({
        combinedPageNumber: index + 1,
        widthPt: 612,
        heightPt: 792,
        paragraphs: [],
        blocks: structurePositioned(items),
      })),
    });
    const diplomaText = await pdfText(diploma.watermarkedPreview);
    expect(diplomaText.text).toContain("陈浩宇");
    assertNoNotdef(diplomaText.text);
    assertWithinPage(await pdfItems(diploma.watermarkedPreview));
    await expectGlyphOutlines(diploma.cleanTranslation, ["陈", "浩", "宇"]);
  });
});

describe("combined original", () => {
  it("keeps upload order and gives the viewer one page per original side", async () => {
    const src = await PDFDocument.create();
    src.addPage([200, 400]);
    src.addPage([300, 500]);
    const pdf = await src.save();

    const combined = await buildCombinedOriginal([
      { bytes: pdf, mime: "application/pdf" },
      { bytes: PNG, mime: "image/png" },
    ]);

    expect(combined.pages.map((page) => page.sourcePage)).toEqual([1, 2, 1]);
    expect(combined.pages.map((page) => [page.widthPt, page.heightPt])).toEqual([
      [200, 400],
      [300, 500],
      [612, 792],
    ]);

    const loaded = await PDFDocument.load(combined.pdf);
    expect(loaded.getPageCount()).toBe(3);
  });
});
