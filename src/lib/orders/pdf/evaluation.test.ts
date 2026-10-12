import { inflateSync } from "node:zlib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { PREVIEW_WATERMARK } from "../constants";
import type { EvaluationResult } from "../types";
import { evaluationReportId, renderEvaluationPdfs } from "./evaluation";

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
  it("follows the diploma comp: title, prepared-for line, then a light-blue equivalency box", async () => {
    const files = await renderEvaluationPdfs(diploma);
    const clean = await textOf(files.clean);
    const title = clean.indexOf("Educational Credential Evaluation");
    const prepared = clean.indexOf("Prepared for Ada Lovelace");
    const label = clean.indexOf("U.S. EQUIVALENCY");
    const equivalency = clean.indexOf("Bachelor's degree");
    expect(title).toBeGreaterThanOrEqual(0);
    expect(title).toBeLessThan(prepared);
    expect(prepared).toBeLessThan(label);
    expect(label).toBeLessThan(equivalency);
    expect(clean).toContain("DOCUMENTS REVIEWED");
    expect(clean).toContain("fr_diplome-licence.pdf");
    expect(clean).toContain("CredPronto Certification Team");
    expect(clean).toContain("CredPronto · credpronto.com · 2520 Venture Oaks Way, Suite 120, Sacramento, CA 95833");
    expect(clean).not.toContain("Credential Evaluator");
    expect(clean).not.toContain(PREVIEW_WATERMARK);
    const painted = pdfOperators(files.clean);
    const equivalencyAt = painted.indexOf("Bachelor");
    const fill = painted.slice(0, equivalencyAt < 0 ? painted.length : equivalencyAt);
    expect(fill).toMatch(/0\.9176\d* 0\.9411\d* 1 rg/);
    expect(fill).toMatch(/0\.1215\d* 0\.3686\d* 1 rg/);
    const preview = await textOf(files.preview);
    expect(preview).toContain(PREVIEW_WATERMARK);
  });

  it("follows the course comp: GPA at the top, a year group, a totals row, and the grade scale", async () => {
    const files = await renderEvaluationPdfs(courses);
    const clean = await textOf(files.clean);
    const title = clean.indexOf("Course-by-Course Evaluation");
    const gpaLabel = clean.indexOf("U.S. GPA");
    const gpa = clean.indexOf("3.70");
    const year = clean.indexOf("2018");
    const course = clean.indexOf("Algèbre");
    const english = clean.indexOf("Algebra");
    const totals = clean.indexOf("Total");
    const scale = clean.indexOf("Grade scale");
    expect(title).toBeGreaterThanOrEqual(0);
    expect(title).toBeLessThan(gpaLabel);
    expect(gpaLabel).toBeLessThan(gpa);
    expect(gpa).toBeLessThan(year);
    expect(year).toBeLessThan(course);
    expect(course).toBeLessThan(english);
    expect(english).toBeLessThan(totals);
    expect(clean.indexOf("6", totals)).toBeGreaterThan(totals);
    expect(clean.slice(totals)).toContain("3.70");
    expect(scale).toBeGreaterThan(totals);
    expect(clean.slice(scale)).toContain("20-point scale");
    const preview = await textOf(files.preview);
    expect(preview).toContain(PREVIEW_WATERMARK);
    expect(await textOf(files.clean)).not.toContain(PREVIEW_WATERMARK);
  });

  it("prints Pending staff review in the equivalency box", async () => {
    const files = await renderEvaluationPdfs({
      ...diploma,
      credentials: diploma.credentials.map((credential) => ({
        ...credential,
        usEquivalency: "Pending staff review",
      })),
    });
    const clean = await textOf(files.preview);
    const label = clean.indexOf("U.S. EQUIVALENCY");
    const pending = clean.indexOf("Pending staff review");
    expect(label).toBeGreaterThanOrEqual(0);
    expect(pending).toBeGreaterThan(label);
  });

  it("builds a stable report id from the order id", () => {
    expect(evaluationReportId("4b7cd466-eb4f-cdb3-5cbf-c62a9efcfcc8")).toBe("CP-E-4B7CD466");
  });
});
