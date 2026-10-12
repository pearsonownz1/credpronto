import { inflateSync } from "node:zlib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { PREVIEW_WATERMARK } from "../constants";
import type { EvaluationResult } from "../types";
import { renderEvaluationPdfs } from "./evaluation";

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

async function textOf(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes.slice());
  const extracted = await extractText(proxy, { mergePages: false });
  return extracted.text.join("\n");
}

const diploma: EvaluationResult = {
  kind: "diploma",
  credentials: [
    {
      applicant: "Ada Lovelace",
      institution: "Université de Paris",
      country: "France",
      credential: "Licence",
      field: "Mathematics",
      dates: "2016–2019",
      usEquivalency: "Bachelor's degree",
      documentsReviewed: ["fr_diplome-licence.pdf"],
    },
  ],
};

const courses: EvaluationResult = {
  kind: "course_by_course",
  applicant: "Ada Lovelace",
  institution: "Université de Paris",
  country: "France",
  credential: "Licence",
  years: [
    {
      year: "2018–2019",
      courses: [
        {
          originalName: "Algèbre",
          englishName: "Algebra",
          localCredits: 6,
          localGrade: "14",
          usSemesterHours: 6,
          usGrade: "A-",
          gradePoints: 22.2,
        },
      ],
    },
  ],
  totalHours: 6,
  gpa: 3.7,
  gradeScale: "Grades are on a 20-point scale. 16–20 is A (4.0).",
};

describe("evaluation PDFs", () => {
  it("puts the equivalency in a blue box at the top of a diploma report", async () => {
    const files = await renderEvaluationPdfs(diploma);
    const clean = await textOf(files.clean);
    const equivalency = clean.indexOf("Bachelor's degree");
    expect(equivalency).toBeGreaterThanOrEqual(0);
    expect(equivalency).toBeLessThan(clean.indexOf("Ada Lovelace"));
    expect(clean).toContain("Documents reviewed");
    expect(clean).toContain("fr_diplome-licence.pdf");
    expect(clean).not.toContain(PREVIEW_WATERMARK);
    const painted = pdfOperators(files.clean);
    const equivalencyAt = painted.indexOf("Bachelor");
    const fill = painted.slice(0, equivalencyAt < 0 ? painted.length : equivalencyAt);
    expect(fill).toMatch(/0\.1215\d* 0\.3686\d* 1 rg/);
    const preview = await textOf(files.preview);
    expect(preview).toContain(PREVIEW_WATERMARK);
  });

  it("prints hours and GPA at the top, a year group, a totals row, and the grade scale", async () => {
    const files = await renderEvaluationPdfs(courses);
    const clean = await textOf(files.clean);
    const top = clean.indexOf("GPA 3.70");
    const year = clean.indexOf("2018–2019");
    const course = clean.indexOf("Algèbre");
    const totals = clean.indexOf("Totals");
    const scale = clean.indexOf("Grade scale");
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(year);
    expect(year).toBeLessThan(course);
    expect(course).toBeLessThan(totals);
    expect(clean.indexOf("6", totals)).toBeGreaterThan(totals);
    expect(scale).toBeGreaterThan(totals);
    expect(clean.slice(scale)).toContain("20-point scale");
    const preview = await textOf(files.preview);
    expect(preview).toContain(PREVIEW_WATERMARK);
    expect(await textOf(files.clean)).not.toContain(PREVIEW_WATERMARK);
  });
});
