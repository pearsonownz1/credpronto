import { describe, expect, it } from "vitest";
import { PENDING_EQUIVALENCY } from "./equivalency";
import { resolveEdgeCountrySlug, type Db } from "./db";
import {
  chooseEquivalency,
  combineEquivalencyRoutes,
  countrySlug,
  countrySlugFallbackFilter,
  draftEquivalency,
  edgeContentExcerpt,
  edgeEquivalencyPrompt,
  edgeRowsFromSource,
  equivalencyCredentialId,
  mapEdgeEquivalencyRow,
  matchEdgeCredential,
  matchEdgeGradingScale,
  pickEdgeEquivalency,
  resolveStoredCountrySlug,
  staffEdgeView,
  type EdgeCredentialRecord,
  type EdgeEquivalencyRecord,
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

  it("matches a short order country to the official-name slug, and refuses an ambiguous one", () => {
    const south = "korea-republic-of-south-korea";
    const north = "korea-democratic-peoples-republic-of-north-korea";
    expect(countrySlug("Korea, Republic of (South Korea)")).toBe(south);
    expect(countrySlugFallbackFilter("south-korea")).toBe(
      "country_slug.like.south-korea-*,country_slug.like.*-south-korea,country_slug.like.*-south-korea-*",
    );
    expect(resolveStoredCountrySlug("south-korea", [south, "mexico"])).toBe(south);
    expect(resolveStoredCountrySlug("korea", [south])).toBe(south);
    expect(resolveStoredCountrySlug("korea", [south, north])).toBeNull();
    expect(resolveStoredCountrySlug("mexico", ["mexico", "new-mexico"])).toBe("mexico");
    expect(resolveStoredCountrySlug("guinea", ["papua-new-guinea", "equatorial-guinea"])).toBeNull();
    expect(resolveStoredCountrySlug("niger", ["nigeria"])).toBeNull();

    const rows = [
      credential({ id: "south", title: "Example Diploma", countrySlug: south, country: "Korea, Republic of (South Korea)" }),
      credential({ id: "mexico", title: "Example Diploma", countrySlug: "mexico", country: "Mexico" }),
      credential({ id: "new-mexico", title: "Example Diploma", countrySlug: "new-mexico", country: "New Mexico" }),
      credential({ id: "nigeria", title: "Example Diploma", countrySlug: "nigeria", country: "Nigeria" }),
    ];
    expect(matchEdgeCredential(rows, { country: "South Korea", title: "Example Diploma" })?.id).toBe("south");
    expect(matchEdgeCredential(rows, { country: "Korea", title: "Example Diploma" })?.id).toBe("south");
    expect(matchEdgeCredential(rows, { country: "México", title: "Example Diploma" })?.id).toBe("mexico");
    expect(matchEdgeCredential(rows, { country: "Niger", title: "Example Diploma" })).toBeNull();
    expect(
      matchEdgeCredential(
        [...rows, credential({ id: "north", title: "Example Diploma", countrySlug: north, country: "North Korea" })],
        { country: "Korea", title: "Example Diploma" },
      ),
    ).toBeNull();
  });

  it("matches a grading scale from a section, name, or raw entry", () => {
    const south = "korea-republic-of-south-korea";
    expect(
      matchEdgeGradingScale(
        [
          scale({
            id: "higher",
            title: "Higher education — Example Diploma — universities",
            raw: "Example Diploma is the original entry.",
            rows: [],
            countrySlug: south,
          }),
          scale({
            id: "secondary",
            title: "Secondary — Example Certificate — schools",
            raw: "Example Certificate notes.",
            rows: [],
            countrySlug: south,
          }),
        ],
        { country: "South Korea", title: "Example Diploma in Testing", grades: [] },
      )?.id,
    ).toBe("higher");
    expect(
      matchEdgeGradingScale(
        [
          scale({ id: "a", title: "Higher education — Example Diploma — universities", rows: [], countrySlug: "mexico" }),
          scale({ id: "b", title: "Higher education — Example Diploma — technical", rows: [], countrySlug: "mexico" }),
        ],
        { country: "Mexico", title: "Example Diploma in Testing", grades: [] },
      ),
    ).toBeNull();
    expect(
      matchEdgeGradingScale(
        [
          scale({
            id: "raw",
            title: "Higher education — Other name — universities",
            raw: "Used for the Example Diploma.",
            rows: [],
            countrySlug: "mexico",
          }),
          scale({
            id: "other",
            title: "Secondary — Example Certificate — schools",
            raw: "Nothing relevant.",
            rows: [],
            countrySlug: "mexico",
          }),
        ],
        { country: "Mexico", title: "Example Diploma", grades: [] },
      )?.id,
    ).toBe("raw");
    expect(
      matchEdgeGradingScale(
        [
          scale({
            id: "ten",
            title: "Higher education — Ten point — universities",
            countrySlug: south,
            rows: [{ indigenousGrade: "10", usEquivalent: "A" }],
          }),
          scale({
            id: "letters",
            title: "Higher education — Letters — universities",
            countrySlug: south,
            rows: [{ indigenousGrade: "MB", usEquivalent: "B" }],
          }),
        ],
        { country: "Korea", title: "Example Diploma", grades: ["10"] },
      )?.id,
    ).toBe("ten");
  });

  it("loads the exact country slug, then one fallback slug", async () => {
    const exact = scriptedEdgeDb([
      { data: [{ country_slug: "mexico" }] },
      { data: [] },
    ]);
    expect(await resolveEdgeCountrySlug(exact.db, "mexico")).toBe("mexico");
    expect(exact.calls.map((call) => call.op)).toEqual(["eq", "eq"]);

    const south = "korea-republic-of-south-korea";
    const fallback = scriptedEdgeDb([
      { data: [] },
      { data: [] },
      { data: [{ country_slug: south }] },
      { data: [{ country_slug: south }] },
    ]);
    expect(await resolveEdgeCountrySlug(fallback.db, "south-korea")).toBe(south);
    expect(fallback.calls[2]?.value).toContain("country_slug.like.*-south-korea");

    const ambiguous = scriptedEdgeDb([
      { data: [] },
      { data: [] },
      { data: [{ country_slug: south }, { country_slug: "korea-democratic-peoples-republic-of-north-korea" }] },
      { data: [] },
    ]);
    expect(await resolveEdgeCountrySlug(ambiguous.db, "korea")).toBeNull();
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

function equivalency(patch: Partial<EdgeEquivalencyRecord> & { id: string; confidence: EdgeEquivalencyRecord["confidence"] }): EdgeEquivalencyRecord {
  return {
    edgeCredentialId: "cred-1",
    country: "Mexico",
    credentialTitle: "Example Diploma",
    edgeLevel: "6",
    usEquivalency: "Bachelor's degree",
    basis: "First university degree in the fictional catalog.",
    ...patch,
  };
}

describe("EDGE equivalency suggestions", () => {
  it("maps a row and prefers the higher confidence suggestion", () => {
    expect(
      mapEdgeEquivalencyRow({
        id: "row-1",
        edge_credential_id: "cred-1",
        country: "Mexico",
        credential_title: "Example Diploma",
        edge_level: "6",
        us_equivalency: "Bachelor's degree",
        basis: "First university degree.",
        confidence: "medium",
      }),
    ).toMatchObject({ id: "row-1", edgeCredentialId: "cred-1", confidence: "medium", edgeLevel: "6" });
    expect(mapEdgeEquivalencyRow({ id: "row-1", confidence: "certain" })).toBeNull();
    const picked = pickEdgeEquivalency([
      equivalency({ id: "low", confidence: "low" }),
      equivalency({ id: "high", confidence: "high" }),
      equivalency({ id: "medium", confidence: "medium" }),
    ]);
    expect(picked?.id).toBe("high");
  });

  it("fills a confident suggestion and sends a weak or missing one to research", () => {
    expect(equivalencyCredentialId({ matchedId: "matched", storedId: "stored", singleCredential: true })).toBe("matched");
    expect(equivalencyCredentialId({ matchedId: null, storedId: "stored", singleCredential: true })).toBe("stored");
    expect(equivalencyCredentialId({ matchedId: null, storedId: "stored", singleCredential: false })).toBeNull();

    const high = draftEquivalency({
      printed: "Example Diploma",
      suggestion: equivalency({ id: "high", confidence: "high" }),
      fallback: PENDING_EQUIVALENCY,
    });
    expect(high).toEqual({
      usEquivalency: "Bachelor's degree",
      basis: "First university degree in the fictional catalog.",
      route: "qa_review",
    });
    expect(
      draftEquivalency({
        printed: "Example Diploma",
        suggestion: equivalency({ id: "medium", confidence: "medium", usEquivalency: "Master's degree" }),
        fallback: PENDING_EQUIVALENCY,
      }).route,
    ).toBe("qa_review");
    expect(
      draftEquivalency({
        printed: "Licence",
        suggestion: equivalency({ id: "low", confidence: "low" }),
        fallback: PENDING_EQUIVALENCY,
      }),
    ).toMatchObject({ usEquivalency: "Bachelor's degree", route: "qa_research" });
    expect(
      draftEquivalency({
        printed: "Certificado",
        suggestion: null,
        fallback: PENDING_EQUIVALENCY,
      }),
    ).toEqual({ usEquivalency: PENDING_EQUIVALENCY, basis: null, route: "qa_research" });
    expect(combineEquivalencyRoutes(["qa_review", "qa_review"])).toBe("qa_review");
    expect(combineEquivalencyRoutes(["qa_review", "qa_research"])).toBe("qa_research");
    expect(combineEquivalencyRoutes([])).toBe("qa_research");
  });
});

function scriptedEdgeDb(script: Array<{ data: unknown[] }>): {
  db: Db;
  calls: Array<{ table: string; op: "eq" | "or"; value: string }>;
} {
  let step = 0;
  const calls: Array<{ table: string; op: "eq" | "or"; value: string }> = [];
  const db = {
    from(table: string) {
      const call = { table, op: "eq" as "eq" | "or", value: "" };
      const builder = {
        select() {
          return builder;
        },
        eq(_column: string, value: string) {
          call.op = "eq";
          call.value = value;
          return builder;
        },
        limit() {
          return builder;
        },
        or(value: string) {
          call.op = "or";
          call.value = value;
          return builder;
        },
        range() {
          return builder;
        },
        then(
          onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
          onRejected?: (error: unknown) => unknown,
        ) {
          calls.push(call);
          const data = script[step++]?.data ?? [];
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { db: db as unknown as Db, calls };
}
