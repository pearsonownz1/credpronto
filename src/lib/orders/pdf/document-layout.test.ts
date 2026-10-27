import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "../ai";
import { PREVIEW_WATERMARK } from "../constants";
import {
  LICENSE_SOURCE,
  OYAK_SOURCE,
  licenseBlocks,
  oyakLetterBlocks,
} from "./attached-documents";
import { buildCombinedOriginal } from "./combine";
import { planDocument, planTable, type PlanStyle } from "./document-layout";
import { fontFace, serifFace, stableFontkit } from "./font";
import { applyGroundedFixes, reconcileIdentifiers, verifyIdentifiers } from "./identifiers";
import { cropHolderPhoto } from "./photo";
import { renderOrderPdfs } from "./render";
import { finalizeBlocks } from "./structure";
import { parsePageJobOutput } from "../translation-jobs";

const ORIGINALS = path.join(process.cwd(), "src/lib/orders/pdf/fixtures/originals");
const licensePng = new Uint8Array(readFileSync(path.join(ORIGINALS, "license-tr.png")));
const oyakPng = new Uint8Array(readFileSync(path.join(ORIGINALS, "oyak-tr.png")));
const ORDER_ID = "28492f38-1111-4111-8111-111111111111";

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: string[]; pageCount: number }> {
  const proxy = await getDocumentProxy(Uint8Array.from(bytes));
  const extracted = await extractText(proxy, { mergePages: false });
  const pages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  return { text: pages.join("\n"), pages, pageCount: extracted.totalPages };
}

async function measure() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(stableFontkit());
  const regular = await doc.embedFont(fontFace("regular").bytes);
  const serif = await doc.embedFont(serifFace(false).bytes);
  const bold = await doc.embedFont(serifFace(true).bytes);
  return (text: string, size: number, style: PlanStyle) => {
    const font = style.serif ? (style.bold ? bold : serif) : regular;
    return font.widthOfTextAtSize(text, size);
  };
}

describe("attached document layout", () => {
  it("crops the license portrait and leaves the letter alone", async () => {
    const portrait = await cropHolderPhoto(licensePng);
    expect(portrait).not.toBeNull();
    expect(portrait?.subarray(0, 8)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const meta = await PDFDocument.create();
    const image = await meta.embedPng(portrait ?? new Uint8Array());
    expect(image.height).toBeGreaterThan(image.width);
    expect(await cropHolderPhoto(oyakPng)).toBeNull();
  });

  it("gives a landscape original a landscape letter page", async () => {
    const license = await buildCombinedOriginal([{ bytes: licensePng, mime: "image/png" }]);
    expect(license.pages).toEqual([{ widthPt: 792, heightPt: 612, sourceIndex: 0, sourcePage: 1 }]);
    const letter = await buildCombinedOriginal([{ bytes: oyakPng, mime: "image/png" }]);
    expect(letter.pages[0]).toMatchObject({ widthPt: 612, heightPt: 792 });
  });

  it("places the license title, number boxes, and signature like the original", async () => {
    const width = 792;
    const height = 612;
    const plan = planDocument({
      kind: "certificate",
      blocks: licenseBlocks,
      width,
      height,
      footer: 48,
      size: 12,
      measure: await measure(),
      hasPhoto: true,
    });
    expect(plan.frame).toBeTruthy();
    expect(plan.boxes).toHaveLength(2);
    const [leftBox, rightBox] = [...plan.boxes].sort((a, b) => a.x - b.x);
    expect(leftBox && rightBox && leftBox.x).toBeLessThan(width / 2);
    expect(rightBox && rightBox.x).toBeGreaterThan(width / 2);
    const union = plan.texts.find((item) => item.text === "UNION");
    const license = plan.texts.find((item) => item.text === "LICENSE");
    expect(union && union.x).toBeGreaterThan(180);
    expect(license?.bold).toBe(true);
    const kazan = plan.texts.find((item) => item.text.includes("KAZAN"));
    expect(kazan && kazan.x).toBeGreaterThan(width / 2);
    expect(plan.texts.filter((item) => item.text === "[Seal]")).toHaveLength(2);
    expect(plan.texts.filter((item) => item.text === "[SEAL]")).toHaveLength(2);
    expect(plan.seals).toHaveLength(2);
    const sealCenters = [...(plan.seals ?? [])].sort((a, b) => a.cx - b.cx);
    expect(sealCenters[0]?.outer).toBeGreaterThan(sealCenters[0]?.inner ?? 0);
    expect(sealCenters[0]?.cx).toBeLessThan(width / 2);
    expect(sealCenters[1]?.cx).toBeGreaterThan(width / 2);
    expect(plan.texts.some((item) => item.text === "[Holder's photo]")).toBe(true);
    expect(plan.image).toBeTruthy();
    expect(plan.overflow).toBe(false);
    const kept = finalizeBlocks(licenseBlocks);
    expect(kept.filter((block) => block.type === "seal")).toHaveLength(2);
    expect(kept.filter((block) => block.type === "signature")).toHaveLength(1);
  });

  it("keeps the appointment letter on one portrait page with two signature columns", async () => {
    const plan = planDocument({
      kind: "letter",
      blocks: oyakLetterBlocks,
      width: 612,
      height: 792,
      footer: 48,
      size: 11,
      measure: await measure(),
      hasPhoto: false,
    });
    expect(plan.frame).toBeUndefined();
    expect(plan.overflow).toBe(false);
    const hakan = plan.texts.find((item) => item.text === "Hakan");
    const nejat = plan.texts.find((item) => item.text === "Nejat");
    expect(hakan && nejat && hakan.x < nejat.x).toBe(true);
    const labels = plan.texts.filter((item) => item.text === "Document No." || item.text === "Subject");
    expect(labels).toHaveLength(2);
    expect(labels[0]?.x).toBe(labels[1]?.x);
    const colons = plan.texts.filter((item) => item.text === ":");
    expect(colons[0]?.x).toBe(colons[1]?.x);
    expect(plan.texts.some((item) => item.text === "[Logo:")).toBe(true);
    expect(plan.texts.some((item) => item.text === "BANK]")).toBe(true);
    expect(plan.texts.filter((item) => item.text === "[Signature]")).toHaveLength(2);
    expect(plan.texts.some((item) => item.text.startsWith("1)"))).toBe(true);
    expect(plan.texts.some((item) => item.text.startsWith("6)"))).toBe(true);
  });

  it("renders both attached pages with the source numbers, dates, and a short footer", async () => {
    const photo = await cropHolderPhoto(licensePng);
    const wrongLicense = licenseBlocks.map((block) =>
      block.type === "box" && block.value === "24379" ? { ...block, value: "27379" } : block,
    );
    const fixedLicense = reconcileIdentifiers({
      sourceText: LICENSE_SOURCE,
      blocks: wrongLicense,
      sourceLanguage: "tr",
      dateFormat: "MM/DD/YYYY",
    });
    const rendered = await renderOrderPdfs({
      orderId: ORDER_ID,
      sourceLanguage: "tr",
      targetLanguage: "en",
      date: "2026-10-21",
      clientName: "Client",
      documents: [
        { name: "Appointment Letter", sourcePages: 1, translatedPages: 1 },
        { name: "Attorney at Law License", sourcePages: 1, translatedPages: 1 },
      ],
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          paragraphs: [],
          blocks: oyakLetterBlocks,
          kind: "letter",
        },
        {
          combinedPageNumber: 2,
          widthPt: 792,
          heightPt: 612,
          paragraphs: [],
          blocks: fixedLicense,
          kind: "certificate",
          photoPng: photo,
        },
      ],
    });

    const preview = await pdfText(rendered.watermarkedPreview);
    const clean = await pdfText(rendered.cleanTranslation);
    expect(preview.pageCount).toBe(2);
    expect(clean.pageCount).toBe(3);
    expect(preview.text).toContain(PREVIEW_WATERMARK);
    expect(clean.text).not.toContain("PREVIEW");
    expect(preview.text).toContain("Çiğdem DAYAN");
    expect(preview.text).toContain("ÇİĞDEM DAYAN");
    expect(preview.text).toContain("01/31/2006");
    expect(preview.text).toContain("09/07/1989");
    expect(preview.text).toContain("24379");
    expect(preview.text).toContain("15993");
    expect(preview.text).not.toContain("27379");
    expect(preview.text).toContain("[Logo: OYAK BANK]");
    expect(preview.text).toContain("[Signature]");
    expect(preview.text).toContain("[Holder's photo]");
    expect(preview.text).toContain("[Seal]");
    expect(preview.text).toContain("Atatürk");
    expect(preview.text).toContain("Kavaklıdere");

    const cleanDoc = await PDFDocument.load(rendered.cleanTranslation);
    expect(cleanDoc.getPage(0).getSize()).toMatchObject({ width: 612, height: 792 });
    expect(cleanDoc.getPage(1).getSize()).toMatchObject({ width: 612, height: 792 });
    expect(cleanDoc.getPage(2).getSize()).toMatchObject({ width: 792, height: 612 });
    expect(clean.pages[0]).toContain("Certified Translator");
    expect(clean.pages[0]).toContain(ORDER_ID);
    expect(clean.pages[1]).toContain("28492f38");
    expect(clean.pages[1]).not.toContain("28492f38-1111");
    expect(clean.pages[2]).not.toContain("28492f38-1111");
    expect(clean.pages[2]).toContain("24379");

    const previewDoc = await PDFDocument.load(rendered.watermarkedPreview);
    const licenseRaw = Buffer.from(await previewDoc.save()).toString("latin1");
    expect(licenseRaw).toContain("/Subtype /Image");
  });
});

describe("identifier check", () => {
  it("rewrites a near-miss union number and a swapped Turkish date", () => {
    const blocks = reconcileIdentifiers({
      sourceText: `${LICENSE_SOURCE}\n${OYAK_SOURCE}`,
      sourceLanguage: "tr",
      dateFormat: "MM/DD/YYYY",
      blocks: [
        { type: "box", label: "Union No.", value: "27379", column: "left" },
        { type: "paragraph", text: "Dated 07/09/1989 and 31/1/2006. Article 25 stays." },
        { type: "kv", label: "Document No.", value: "74" },
      ],
    });
    const box = blocks[0];
    const paragraph = blocks[1];
    expect(box?.type).toBe("box");
    if (box?.type === "box") expect(box.value).toBe("24379");
    if (paragraph?.type === "paragraph") {
      expect(paragraph.text).toContain("09/07/1989");
      expect(paragraph.text).toContain("01/31/2006");
      expect(paragraph.text).toContain("Article 25");
      expect(paragraph.text).not.toContain("07/09/1989");
    }
  });

  it("keeps a model fix only when the replacement is on the source", () => {
    const blocks = [{ type: "paragraph" as const, text: "Union No. 27379" }];
    const rejected = applyGroundedFixes(blocks, [{ wrong: "27379", right: "99999" }], LICENSE_SOURCE);
    expect(rejected[0]?.type === "paragraph" && rejected[0].text).toContain("27379");
    const accepted = applyGroundedFixes(blocks, [{ wrong: "27379", right: "24379" }], LICENSE_SOURCE);
    expect(accepted[0]?.type === "paragraph" && accepted[0].text).toContain("24379");
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call the model when the page has no digits", async () => {
    const spy = vi.spyOn(ai, "generateObject");
    const blocks = await verifyIdentifiers({
      sourceText: "ACTA DE NACIMIENTO",
      blocks: [{ type: "paragraph", text: "Birth certificate" }],
      sourceLanguage: "es-mx",
      dateFormat: "MM/DD/YYYY",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(blocks[0]?.type === "paragraph" && blocks[0].text).toBe("Birth certificate");
  });

  it("keeps the reconciled number when the check fails", async () => {
    vi.spyOn(ai, "generateObject").mockRejectedValue(new Error("down"));
    const blocks = await verifyIdentifiers({
      sourceText: LICENSE_SOURCE,
      blocks: [{ type: "box", label: "Union No.", value: "27379", column: "left" }],
      sourceLanguage: "tr",
      dateFormat: "MM/DD/YYYY",
    });
    expect(blocks[0]?.type === "box" && blocks[0].value).toBe("24379");
  });
});

describe("page job blocks", () => {
  it("keeps certificate blocks and the page kind", () => {
    const parsed = parsePageJobOutput({
      kind: "certificate",
      blocks: licenseBlocks,
      paragraphs: ["Attorney at Law License"],
    });
    expect(parsed?.kind).toBe("certificate");
    expect(parsed?.blocks.some((block) => block.type === "box")).toBe(true);
    expect(parsed?.blocks.some((block) => block.type === "photo")).toBe(true);
  });

  it("keeps a layout fallback flag on a flat letter page", () => {
    const parsed = parsePageJobOutput({
      kind: "letter",
      layoutFallback: "flat",
      blocks: [{ type: "paragraph", text: "Hello from the bank." }],
      paragraphs: ["Hello from the bank."],
    });
    expect(parsed?.layoutFallback).toBe("flat");
    expect(parsed?.kind).toBe("letter");
  });
});

const charMeasure = (text: string) => text.length * 5;

describe("diploma certificate layout", () => {
  it("lays signatories across the page and keeps a registry strip inside a snug frame", async () => {
    const width = 842;
    const height = 1190;
    const footer = 48;
    const plan = planDocument({
      kind: "certificate",
      blocks: [
        { type: "heading", text: "Graduate in Biotechnology", align: "center", bold: true },
        { type: "kv", label: "", value: "022A-084542" },
        { type: "kv", label: "Alphanumeric code", value: "" },
        {
          type: "table",
          header: false,
          rows: [[
            "Alphanumeric code: 022A-084542",
            "National Register of Degrees: 2020/217459",
            "Center code: 08071020",
            "University Register of Degrees: 227295",
            "University file No.: 14655910H5051",
          ]],
        },
        { type: "signature", electronic: false, lines: ["Judit Giménez Roig", "The holder"] },
        { type: "signature", electronic: false, lines: ["Margarita Arboix Arzo", "The Rector"] },
        { type: "signature", electronic: false, lines: ["Joaquín Bernabé Ródenas", "Head of Academic Affairs"] },
      ],
      width,
      height,
      footer,
      size: 12,
      measure: await measure(),
      hasPhoto: false,
    });

    expect(plan.texts.some((item) => item.text === ":")).toBe(false);
    expect(plan.texts.some((item) => item.text === "022A-084542")).toBe(true);
    expect(plan.texts.some((item) => item.text === "Alphanumeric")).toBe(true);

    const judit = plan.texts.find((item) => item.text === "Judit");
    const margarita = plan.texts.find((item) => item.text === "Margarita");
    const joaquin = plan.texts.find((item) => item.text === "Joaquín");
    expect(judit && margarita && joaquin).toBeTruthy();
    expect(judit!.x).toBeLessThan(margarita!.x);
    expect(margarita!.x).toBeLessThan(joaquin!.x);
    expect(judit!.y).toBeCloseTo(margarita!.y, 0);
    expect(margarita!.y).toBeCloseTo(joaquin!.y, 0);
    const span = joaquin!.x - judit!.x;
    expect(span).toBeGreaterThan(width * 0.35);

    const fullFrame = height - footer - 6 - 22;
    expect(plan.frame).toBeTruthy();
    expect(plan.frame!.h).toBeLessThan(fullFrame * 0.65);
    expect(plan.frame!.y).toBeGreaterThan(footer + 6);
    const tableInk = plan.texts.filter((item) => item.text.includes("08071020") || item.text === "08071020");
    expect(tableInk.length).toBeGreaterThan(0);
    for (const item of tableInk) expect(item.y).toBeGreaterThan(plan.frame!.y);

    const horizontals = (plan.rules ?? []).filter((rule) => rule.y1 === rule.y2);
    const verticals = (plan.rules ?? []).filter((rule) => rule.x1 === rule.x2);
    expect(horizontals.length).toBeGreaterThanOrEqual(2);
    expect(verticals.length).toBeGreaterThanOrEqual(6);
    const top = Math.max(...horizontals.map((rule) => rule.y1));
    const bottom = Math.min(...horizontals.map((rule) => rule.y1));
    expect(bottom).toBeLessThan(top);
    expect(bottom).toBeGreaterThan(plan.frame!.y);
  });

  it("keeps one signature on the right and a full certificate frame when the page is filled", async () => {
    const rows = Array.from({ length: 32 }, (_, index) => ({
      type: "kv" as const,
      label: `Field ${index + 1}`,
      value: `Value ${index + 1}`,
    }));
    const plan = planDocument({
      kind: "certificate",
      blocks: [
        ...rows,
        { type: "signature", electronic: false, lines: ["Margarita Arboix Arzo", "The Rector"] },
      ],
      width: 612,
      height: 792,
      footer: 48,
      size: 11,
      measure: await measure(),
      hasPhoto: false,
    });
    const label = plan.texts.find((item) => item.text === "Field");
    const rector = plan.texts.find((item) => item.text === "Margarita");
    if (!label || !rector) throw new Error("missing signature placement");
    expect(rector.x).toBeGreaterThan(label.x);
    expect(rector.x).toBeGreaterThan(612 / 2);
    const fullFrame = 792 - 48 - 6 - 22;
    expect(plan.frame!.h).toBeGreaterThan(fullFrame * 0.9);
  });

  it("draws a full grid on a headerless registry table", () => {
    const rows = [
      ["Alphanumeric code", "National register", "Center code", "University register", "File no."],
      ["022A-084542", "2020/217459", "08071020", "227295", "14655910H5051"],
    ];
    const plan = planTable({
      rows,
      header: false,
      x: 40,
      y: 700,
      width: 500,
      size: 10,
      bottom: 40,
      serif: false,
      measure: charMeasure,
    });
    const horizontals = plan.rules.filter((rule) => rule.y1 === rule.y2).sort((a, b) => b.y1 - a.y1);
    const verticals = plan.rules.filter((rule) => rule.x1 === rule.x2);
    expect(horizontals).toHaveLength(3);
    expect(horizontals[0]?.y1).toBe(700);
    expect(horizontals[0]?.width).toBeGreaterThan(0);
    expect(horizontals[2]?.y1).toBeLessThan(700);
    expect(horizontals[2]?.width).toBeGreaterThanOrEqual(0.6);
    expect(verticals).toHaveLength(6);
    const xs = [...verticals.map((rule) => rule.x1)].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(40);
    expect(xs[5]).toBeCloseTo(540);
    for (const rule of verticals) {
      expect(Math.max(rule.y1, rule.y2)).toBe(horizontals[0]!.y1);
      expect(Math.min(rule.y1, rule.y2)).toBe(horizontals[2]!.y1);
    }
  });
});
