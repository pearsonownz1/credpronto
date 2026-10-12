import { describe, expect, it } from "vitest";
import { PENDING_EQUIVALENCY } from "./equivalency";
import {
  chooseEquivalency,
  countrySlug,
  edgeContentExcerpt,
  edgeEquivalencyPrompt,
  edgeRowsFromSource,
  matchEdgeCredential,
  matchEdgeGradingScale,
  staffEdgeView,
  type EdgeCredentialRecord,
  type EdgeGradingScaleRecord,
} from "./edge";

function credential(patch: Partial<EdgeCredentialRecord> & { id: string; title: string }): EdgeCredentialRecord {
  return {
    countrySlug: "mexico",
    country: "Mexico",
    content: "Example content for a fictional credential used only in tests.",
    levelNumber: 6,
    levelTitle: "First university degree",
    url: "https://example.test/edge",
    usEquivalency: null,
    ...patch,
  };
}

function scale(patch: Partial<EdgeGradingScaleRecord> & { id: string; title: string }): EdgeGradingScaleRecord {
  return {
    countrySlug: "mexico",
    raw: null,
    rows: [
      { indigenousGrade: "10", usEquivalent: "A" },
      { indigenousGrade: "8", usEquivalent: "B" },
    ],
    ...patch,
  };
}

describe("EDGE reference matching", () => {
  it("maps a country group into credential and grading-scale rows", () => {
    expect(countrySlug("México")).toBe("mexico");
    expect(countrySlug("Côte d'Ivoire")).toBe("cote-d-ivoire");
    expect(countrySlug("United States")).toBe("united-states");
    const rows = edgeRowsFromSource({
      mexico: {
        country: "Mexico",
        credentials: [
          {
            title: "Example Diploma",
            content: "Fictional description.",
            level: { number: 6, title: "First university degree" },
            url: "https://example.test/edge",
            us_equivalency: "Bachelor's degree",
          },
          { title: " ", content: "skip" },
        ],
        grading_scales: [
          {
            title: "Example scale",
            raw: "10 = A",
            rows: [
              { indigenous_grade: "10", us_equivalent: "A" },
              { indigenous_grade: "", us_equivalent: "B" },
            ],
          },
        ],
      },
      "United States": {
        credentials: [{ title: "Example High School", content: "", level: { number: 3, title: "Secondary" }, url: "", us_equivalency: "" }],
        grading_scales: [],
      },
    });
    expect(rows.credentials).toEqual([
      {
        country_slug: "mexico",
        country: "Mexico",
        title: "Example Diploma",
        content: "Fictional description.",
        level_number: 6,
        level_title: "First university degree",
        url: "https://example.test/edge",
        us_equivalency: "Bachelor's degree",
      },
      {
        country_slug: "united-states",
        country: "United States",
        title: "Example High School",
        content: "",
        level_number: 3,
        level_title: "Secondary",
        url: null,
        us_equivalency: null,
      },
    ]);
    expect(rows.gradingScales).toEqual([
      {
        country_slug: "mexico",
        title: "Example scale",
        raw: "10 = A",
        rows: [{ indigenous_grade: "10", us_equivalent: "A" }],
      },
    ]);
  });

  it("matches a normalized title, then a fuzzy title in the same country", () => {
    const rows = [
      credential({ id: "exact", title: "Example Diploma" }),
      credential({ id: "other", title: "Example Certificate", countrySlug: "france", country: "France" }),
    ];
    expect(matchEdgeCredential(rows, { country: "México", title: " example   diploma " })?.id).toBe("exact");
    expect(matchEdgeCredential(rows, { country: "France", title: "Example Diploma" })).toBeNull();
    expect(matchEdgeCredential(rows, { country: PENDING_EQUIVALENCY, title: "Example Diploma" })).toBeNull();
    expect(
      matchEdgeCredential(
        [credential({ id: "broad", title: "Example Diploma" })],
        { country: "Mexico", title: "Example Diploma in Testing" },
      )?.id,
    ).toBe("broad");
    expect(
      matchEdgeCredential(
        [
          credential({ id: "arts", title: "Example Diploma of Arts" }),
          credential({ id: "science", title: "Example Diploma of Science" }),
        ],
        { country: "Mexico", title: "Example Diploma" },
      ),
    ).toBeNull();
  });

  it("picks the grading scale whose rows match the printed grades", () => {
    const scales = [
      scale({ id: "ten", title: "Ten point", rows: [{ indigenousGrade: "10", usEquivalent: "A" }] }),
      scale({ id: "letters", title: "Letters", rows: [{ indigenousGrade: "MB", usEquivalent: "B" }] }),
    ];
    expect(
      matchEdgeGradingScale(scales, { country: "Mexico", title: "Example Diploma", grades: ["10", "10.0"] })?.id,
    ).toBe("ten");
    expect(
      matchEdgeGradingScale(scales, { country: "Mexico", title: "Example Diploma", grades: ["10", "MB"] }),
    ).toBeNull();
    expect(
      matchEdgeGradingScale([scale({ id: "only", title: "Only scale" })], {
        country: "Mexico",
        title: "Something else",
        grades: [],
      })?.id,
    ).toBe("only");
  });

  it("keeps an unmapped equivalency when EDGE does not support a confident label", () => {
    expect(
      chooseEquivalency({ matched: false, edgeUsEquivalency: null, ai: null, printed: "Licence" }),
    ).toBe("Bachelor's degree");
    expect(
      chooseEquivalency({ matched: false, edgeUsEquivalency: null, ai: null, printed: "Certificado" }),
    ).toBe(PENDING_EQUIVALENCY);
    expect(
      chooseEquivalency({
        matched: true,
        edgeUsEquivalency: null,
        ai: { usEquivalency: "Bachelor's degree", confident: true },
        printed: "Example Diploma",
      }),
    ).toBe("Bachelor's degree");
    expect(
      chooseEquivalency({
        matched: true,
        edgeUsEquivalency: "Bachelor's degree",
        ai: { usEquivalency: "", confident: false },
        printed: "Example Diploma",
      }),
    ).toBe("Bachelor's degree");
    expect(
      chooseEquivalency({
        matched: true,
        edgeUsEquivalency: null,
        ai: { usEquivalency: "", confident: false },
        printed: "Licence",
      }),
    ).toBe(PENDING_EQUIVALENCY);
  });

  it("shows staff a short excerpt and the grading rows, not the whole entry", () => {
    const view = staffEdgeView({
      credential: credential({
        id: "exact",
        title: "Example Diploma",
        content: "A".repeat(500),
        url: "javascript:alert(1)",
      }),
      scale: scale({ id: "ten", title: "Example scale" }),
    });
    expect(view?.title).toBe("Example Diploma");
    expect(view?.levelNumber).toBe(6);
    expect(view?.levelTitle).toBe("First university degree");
    expect(view?.contentExcerpt.endsWith("…")).toBe(true);
    expect(view?.contentExcerpt.length).toBeLessThan(500);
    expect(view?.url).toBeNull();
    expect(view?.gradingScale?.rows[0]).toEqual({ indigenousGrade: "10", usEquivalent: "A" });
    expect(edgeContentExcerpt("short")).toBe("short");
    const prompt = edgeEquivalencyPrompt({
      country: "Mexico",
      printedTitle: "Example Diploma in Testing",
      edgeTitle: "Example Diploma",
      levelNumber: 6,
      levelTitle: "First university degree",
      contentExcerpt: "Fictional excerpt",
      usEquivalencyHint: null,
      gradingRows: [{ indigenousGrade: "10", usEquivalent: "A" }],
    });
    expect(prompt).toContain("EDGE level: number 6, First university degree");
    expect(prompt).toContain("10 = A");
    expect(prompt).toContain("confident");
  });
});
