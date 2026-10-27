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
import { paintedPlanText, planDocument, type PlanStyle } from "./document-layout";
import { normalizedPageSize, type RenderBlock } from "./layout";
import { fontFace, serifFace, stableFontkit } from "./font";
import { applyGroundedFixes, reconcileIdentifiers, verifyIdentifiers } from "./identifiers";
import { cropHolderPhoto } from "./photo";
import { renderOrderPdfs } from "./render";
import { blocksToParagraphs, finalizeBlocks } from "./structure";
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

const DIPLOMA_FRONT: RenderBlock[] = [
  { type: "heading", text: "Felipe VI, King of Spain", align: "center", bold: true },
  { type: "paragraph", text: "and on his behalf, the Rector of the Universitat Autònoma de Barcelona", align: "center" },
  { type: "paragraph", text: "Judit Giménez Roig", align: "center", bold: true },
  { type: "paragraph", text: "born on 08/15/1997 in Premià de Mar (Maresme), of Spanish nationality, completed in July 2020 the official university studies leading to the official university degree of" },
  { type: "heading", text: "Graduate in Biotechnology from the Universitat Autònoma de Barcelona", align: "center", bold: true },
  { type: "paragraph", text: "Bellaterra (Cerdanyola del Vallès), 10/01/2020", align: "center" },
  { type: "signature", electronic: false, lines: ["The holder", "Judit Giménez Roig"] },
  { type: "signature", electronic: false, lines: ["The Rector", "Margarita Arboix Arzo"] },
  { type: "signature", electronic: false, lines: ["The Head of the Academic Affairs Department", "Joaquín Bernabé Ródenas"] },
  { type: "box", label: "", value: "022A-084542" },
  { type: "kv", label: "National Register of Degrees", value: "2020/217459" },
  { type: "kv", label: "Center Code", value: "08071020" },
  { type: "kv", label: "University Register of Degrees", value: "227295" },
];

const DIPLOMA_BACK: RenderBlock[] = [
  {
    type: "fields",
    rows: [
      { label: "Alphanumeric code", value: "022A-084542" },
      { label: "National Degree Registry No.", value: "2020/217459" },
      { label: "Institution code", value: "08071020" },
      { label: "University Degree Registry No.", value: "227295" },
      { label: "University file No.", value: "14655910H5051" },
    ],
  },
  { type: "paragraph", text: "Reverse of the official Bachelor's Degree in Biotechnology, issued in Bellaterra (Cerdanyola del Vallès) on 10/01/2020 to Judit Giménez Roig, who completed the studies leading to this degree in July 2020." },
  { type: "signature", electronic: false, lines: ["Head of the Academic Affairs Department", "Joaquín Bernabé Ródenas"] },
  { type: "paragraph", text: "Mark M-02/2020" },
];

describe("Spanish diploma registry tables", () => {
  it("borders the registration strip, keeps an empty label free of a colon, and lines up three signatures", async () => {
    const measureText = await measure();
    const front = planDocument({
      kind: "certificate",
      blocks: DIPLOMA_FRONT,
      width: 612,
      height: 792,
      footer: 48,
      size: 11,
      measure: measureText,
      hasPhoto: false,
    });
    const frontText = paintedPlanText(front);
    expect(front.rules?.length ?? 0).toBeGreaterThan(0);
    expect(frontText).toContain("022A-084542");
    expect(frontText).toContain("2020/217459");
    expect(frontText).toContain("08071020");
    expect(frontText).toContain("227295");
    expect(frontText).not.toContain(": 022A-084542");
    const notes = front.texts.filter((item) => item.text === "[Signature]");
    expect(notes).toHaveLength(3);
    const ys = notes.map((item) => item.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    const xs = [...notes].sort((a, b) => a.x - b.x).map((item) => item.x);
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
    expect(xs[1]).toBeLessThan(xs[2] ?? 0);
    expect((xs[2] ?? 0) - (xs[0] ?? 0)).toBeGreaterThan(140);
    const frontLow = Math.min(...front.texts.map((item) => item.y), ...(front.rules ?? []).map((rule) => Math.min(rule.y1, rule.y2)));
    expect(front.frame?.y).toBeGreaterThan(48 + 6);
    expect(frontLow - (front.frame?.y ?? 0)).toBeGreaterThan(8);
    expect(frontLow - (front.frame?.y ?? 0)).toBeLessThan(72);
    expect(blocksToParagraphs([{ type: "box", label: "", value: "022A-084542" }])).toEqual(["022A-084542"]);

    const back = planDocument({
      kind: "certificate",
      blocks: DIPLOMA_BACK,
      width: 612,
      height: 792,
      footer: 48,
      size: 11,
      measure: measureText,
      hasPhoto: false,
    });
    const backText = paintedPlanText(back);
    expect(back.rules?.length ?? 0).toBeGreaterThan(0);
    expect(backText).toContain("Alphanumeric");
    expect(backText).toContain("14655910H5051");
    expect(backText).not.toContain(": 022A-084542");
    const backLow = Math.min(...back.texts.map((item) => item.y), ...(back.rules ?? []).map((rule) => Math.min(rule.y1, rule.y2)));
    expect(back.frame?.y).toBeGreaterThan(48 + 30);
    expect(backLow - (back.frame?.y ?? 0)).toBeLessThan(72);
  });

  it("hugs a short certificate frame instead of boxing the empty page", async () => {
    const plan = planDocument({
      kind: "certificate",
      blocks: [
        { type: "heading", text: "Graduate in Biotechnology", align: "center", bold: true },
        { type: "paragraph", text: "Judit Giménez Roig", align: "center" },
        { type: "signature", electronic: false, lines: ["The holder", "Judit Giménez Roig"] },
        { type: "signature", electronic: false, lines: ["The Rector", "Margarita Arboix Arzo"] },
        { type: "signature", electronic: false, lines: ["The Head of the Academic Affairs Department", "Joaquín Bernabé Ródenas"] },
      ],
      width: 612,
      height: 792,
      footer: 48,
      size: 12,
      measure: await measure(),
      hasPhoto: false,
    });
    const notes = plan.texts.filter((item) => item.text === "[Signature]");
    expect(notes).toHaveLength(3);
    const ys = notes.map((item) => item.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    expect(plan.frame?.y).toBeGreaterThan(120);
    expect(plan.overflow).toBe(false);
  });

  it("maps an A3 scan onto Letter and keeps Letter landscape", () => {
    expect(normalizedPageSize(841.68, 1190.4)).toEqual({ widthPt: 612, heightPt: 792 });
    expect(normalizedPageSize(1190.4, 841.68)).toEqual({ widthPt: 612, heightPt: 792 });
    expect(normalizedPageSize(792, 612)).toEqual({ widthPt: 792, heightPt: 612 });
    expect(normalizedPageSize(595, 842)).toEqual({ widthPt: 595, heightPt: 842 });
  });
});
