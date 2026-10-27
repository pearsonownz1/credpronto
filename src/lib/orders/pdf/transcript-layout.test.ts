import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { extractTextItems } from "unpdf";
import { describe, expect, it } from "vitest";
import {
  isTableSummaryRow,
  layoutSealBadge,
  planTable,
  sharedTableColumnWidths,
} from "./document-layout";
import { renderOrderPdfs } from "./render";

const measure = (text: string) => text.length * 6;

const HEADER = ["Course", "Cycle", "Title", "Grade", "Credits"];
const COURSE = ["MCB-8853", "3", "Thesis research activity 3", "T", "12"];
const SUMMARY = [
  "Session total (Third cycle)",
  "Credits registered: 12",
  "Credits earned: 12",
  "Credits used in average: 0",
  "Average: N/A",
];

describe("transcript tables", () => {
  it("treats session totals as summary rows and leaves course rows in the grid", () => {
    expect(isTableSummaryRow(SUMMARY)).toBe(true);
    expect(isTableSummaryRow(["Semester total", "Credits: 3"])).toBe(true);
    expect(isTableSummaryRow(["Trimestre d'automne", "Credits registered: 12"])).toBe(true);
    expect(isTableSummaryRow(["Total", "12"])).toBe(true);
    expect(isTableSummaryRow(["", "Credits registered: 12"])).toBe(true);
    expect(isTableSummaryRow(HEADER)).toBe(false);
    expect(isTableSummaryRow(COURSE)).toBe(false);
    expect(isTableSummaryRow(["GRAND TOTAL", "A", "B"])).toBe(false);
    expect(isTableSummaryRow(["Totally unrelated", "A"])).toBe(false);
  });

  it("keeps a course title that contains a colon in the shared course columns", () => {
    const course = ["ETH-7900", "3", "Responsible conduct of research: regulatory frameworks", "A", "1"];
    const summary = ["Session total", "Credits admitted: 12", "Credits enrolled: 12", "Term GPA: 4.11", "Cumulative GPA: 4.11"];
    expect(isTableSummaryRow(course)).toBe(false);
    expect(isTableSummaryRow(summary)).toBe(true);

    const widths = sharedTableColumnWidths({
      tables: [{ rows: [HEADER, course, COURSE, summary], header: true }],
      width: 500,
      size: 10,
      measure: (text) => measure(text),
    });
    const columns = widths.get(5);
    expect(columns).toHaveLength(5);
    expect(columns?.[2]).toBeGreaterThan(columns?.[1] ?? 0);
    const plan = planTable({
      rows: [HEADER, course, summary],
      header: true,
      x: 48,
      y: 640,
      width: 500,
      size: 10,
      bottom: 40,
      serif: false,
      measure: (text) => measure(text),
      columnWidths: columns,
    });
    const at = (label: string) => plan.texts.find((item) => item.text === label)?.x;
    expect(at("ETH-7900")).toBe(at("Course"));
    expect(at("A")).toBe(at("Grade"));
    expect(plan.bands.length).toBeGreaterThan(0);
    const equalFifth = 48 + 500 / 5;
    expect(Math.abs((at("3") ?? 0) - equalFifth)).toBeGreaterThan(8);
  });

  it("shares one set of column widths across every table with the same column count", () => {
    const widths = sharedTableColumnWidths({
      tables: [
        { rows: [HEADER, COURSE, SUMMARY], header: true },
        { rows: [["BIO-1000", "1", "A much longer course title than the first", "A", "3"], SUMMARY], header: false },
      ],
      width: 500,
      size: 10,
      measure: (text) => measure(text),
    });
    const columns = widths.get(5);
    expect(columns).toHaveLength(5);
    expect(columns?.reduce((sum, width) => sum + width, 0)).toBeCloseTo(500, 5);
    expect(columns?.[2]).toBeGreaterThan(columns?.[1] ?? 0);
    expect(columns?.[2]).toBeGreaterThan(columns?.[3] ?? 0);
    const first = planTable({
      rows: [HEADER, COURSE, SUMMARY],
      header: true,
      x: 48,
      y: 640,
      width: 500,
      size: 10,
      bottom: 40,
      serif: false,
      measure: (text) => measure(text),
      columnWidths: columns,
    });
    const second = planTable({
      rows: [["BIO-1000", "1", "A much longer course title than the first", "A", "3"], SUMMARY],
      header: false,
      x: 48,
      y: 400,
      width: 500,
      size: 10,
      bottom: 40,
      serif: false,
      measure: (text) => measure(text),
      columnWidths: columns,
    });
    const courseX = (plan: typeof first, label: string) => plan.texts.find((item) => item.text === label)?.x;
    expect(courseX(first, "Course")).toBe(courseX(second, "BIO-1000"));
    expect(courseX(first, "Title")).toBe(courseX(second, "A"));
    expect(courseX(first, "MCB-8853")).toBe(courseX(first, "Course"));
    expect(first.bands.length).toBeGreaterThan(0);
    expect(first.bands[0]?.w).toBe(500);
    const summaryText = first.texts.find((item) => item.text.startsWith("Session"));
    expect(summaryText?.x).toBe(48 + 5);
  });

  it("keeps wrapped cell glyphs inside the row rules", () => {
    const plan = planTable({
      rows: [["A heading long enough to wrap onto a second line inside this narrow cell"]],
      header: true,
      x: 40,
      y: 500,
      width: 90,
      size: 10,
      bottom: 20,
      serif: false,
      measure: (text) => measure(text),
    });
    const horizontals = plan.rules.filter((rule) => rule.y1 === rule.y2).sort((a, b) => b.y1 - a.y1);
    const top = horizontals[0]?.y1 ?? 0;
    const bottom = horizontals[horizontals.length - 1]?.y1 ?? 0;
    expect(plan.texts.length).toBeGreaterThan(1);
    for (const item of plan.texts) {
      expect(item.y + item.size).toBeLessThanOrEqual(top - 4);
      expect(item.y - item.size * 0.2).toBeGreaterThanOrEqual(bottom + 4);
    }
  });
});

describe("circular seals", () => {
  it("draws a double ring and keeps the seal wording with the badge", () => {
    const placed = layoutSealBadge({
      text: "Civil Registry of Jalisco",
      column: "right",
      left: 48,
      right: 564,
      top: 500,
      measure: (text) => measure(text),
    });
    expect(placed.seal.outer).toBeGreaterThan(placed.seal.inner);
    expect(placed.seal.outer).toBeGreaterThanOrEqual(28);
    expect(placed.seal.outer).toBeLessThanOrEqual(34);
    expect(placed.seal.cx).toBeGreaterThan(300);
    expect(placed.texts.some((item) => item.text === "[SEAL]" && item.bold)).toBe(true);
    expect(placed.texts.some((item) => item.text === "[Seal: Civil Registry of Jalisco]")).toBe(true);
    const center = layoutSealBadge({
      text: "Center",
      column: "center",
      left: 48,
      right: 548,
      top: 400,
      measure: (text) => measure(text),
    });
    expect(center.seal.cx).toBeCloseTo(48 + (548 - 48) / 2, 5);
  });

  it("paints [SEAL] inside rings on a form page", async () => {
    const rendered = await renderOrderPdfs({
      brand: "gcs",
      orderId: "00000000-0000-4000-8000-000000000000",
      sourceLanguage: "es",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Jane Example",
      documents: [{ name: "Record", sourcePages: 1, translatedPages: 1 }],
      pricedPages: 1,
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "form",
          paragraphs: ["Record"],
          blocks: [
            { type: "paragraph", text: "Certified copy." },
            { type: "seal", text: "Civil Registry of Jalisco", column: "right" },
          ],
        },
      ],
    });
    const bytes = new Uint8Array(rendered.cleanTranslation);
    const extracted = await extractTextItems(bytes);
    const page = extracted.items[1] ?? [];
    expect(page.some((item) => item.str === "[SEAL]")).toBe(true);
    expect(page.some((item) => item.str.includes("Civil Registry of Jalisco"))).toBe(true);
    const doc = await PDFDocument.load(new Uint8Array(rendered.cleanTranslation));
    const decoded: string[] = [];
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      const filter = String(object.dict.lookup(PDFName.of("Filter")) ?? "");
      const packed = filter.includes("FlateDecode") ? inflateSync(object.contents) : object.contents;
      decoded.push(Buffer.from(packed).toString("latin1"));
    }
    const drawing = decoded.find((stream) => stream.includes("1.35") && stream.includes("0.7"));
    expect(drawing, "double-ring seal strokes").toBeTruthy();
  });
});

describe("dense GCS transcript pages", () => {
  it("keeps a six-semester page, including the issue line, above the footer", async () => {
    const header = ["Course", "Cycle", "Title", "Grade", "Credits"];
    const summary = ["Session total", "Credits admitted: 12", "Credits enrolled: 12", "Term GPA: 4.11", "Cumulative GPA: 4.11"];
    const tables = Array.from({ length: 6 }, (_, semester) => ({
      type: "table" as const,
      header: true,
      rows: [
        header,
        ["ETH-7900", "3", "Responsible conduct of research: regulatory frameworks", "A", "1"],
        ["MCB-8853", "3", `Thesis research activity ${semester + 1}`, "T", "12"],
        ["BIO-2001", "1", `Laboratory ${semester + 1}`, "A+", "3"],
        ["PHY-1100", "2", `Mechanics ${semester + 1}`, "B", "3"],
        summary,
      ],
    }));
    const rendered = await renderOrderPdfs({
      brand: "gcs",
      orderId: "00000000-0000-4000-8000-000000000000",
      sourceLanguage: "fr",
      targetLanguage: "en",
      date: "2026-10-23",
      clientName: "Jane Example",
      documents: [{ name: "Transcript", sourcePages: 1, translatedPages: 1 }],
      pricedPages: 1,
      pages: [
        {
          combinedPageNumber: 1,
          widthPt: 612,
          heightPt: 792,
          kind: "form",
          paragraphs: ["UNIVERSITÉ LAVAL"],
          blocks: [
            { type: "heading", text: "UNIVERSITÉ LAVAL", level: 1 },
            ...tables,
            { type: "paragraph", text: "Page 2 of 3" },
            { type: "paragraph", text: "Date of issue: 07/25/2019" },
          ],
        },
      ],
    });
    const extracted = await extractTextItems(new Uint8Array(rendered.cleanTranslation));
    const page = extracted.items[1] ?? [];
    const heading = page.find((item) => item.str.includes("UNIVERSIT"));
    const contact = page.find((item) => item.str.includes("support@gcs.org"));
    expect(heading).toBeTruthy();
    expect(contact).toBeTruthy();
    if (!heading || !contact) return;
    const fromBottom = contact.y > heading.y;
    const baseline = (item: { y: number; fontSize: number }) => (fromBottom ? item.y : 792 - item.y - item.fontSize);
    const body = page.filter((item) => {
      const y = baseline(item);
      return y > 48;
    });
    expect(body.some((item) => item.str.includes("ETH-7900") || item.str.includes("ETH"))).toBe(true);
    expect(body.some((item) => item.str.includes("07/25/2019"))).toBe(true);
    expect(body.some((item) => item.str.includes("Page 2 of 3"))).toBe(true);
    const issue = page.filter((item) => item.str.includes("07/25/2019") || item.str.includes("Date of issue"));
    expect(issue.length).toBeGreaterThan(0);
    for (const item of issue) expect(baseline(item)).toBeGreaterThan(48);
    const lowBody = page.filter((item) => baseline(item) <= 48);
    for (const item of lowBody) {
      expect(item.str.includes("ETH") || item.str.includes("Session") || item.str.includes("07/25")).toBe(false);
    }
  });
});
