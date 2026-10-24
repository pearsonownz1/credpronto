import { describe, expect, it } from "vitest";
import { PENDING_EQUIVALENCY } from "./equivalency";
import { resolveEdgeCountrySlug, type Db } from "./db";
import {
  chooseEquivalency,
  combineEquivalencyRoutes,
  countrySlug,
  countrySlugFallbackFilter,
  draftEquivalency,
  NO_EDGE_MATCH_REASON,
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
    expect(matchEdgeCredential(rows, { country: "México", title: " example   diploma " })).toMatchObject({
      id: "exact",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "France", title: "Example Diploma" })).toBeNull();
    expect(matchEdgeCredential(rows, { country: PENDING_EQUIVALENCY, title: "Example Diploma" })).toBeNull();
    expect(
      matchEdgeCredential(
        [credential({ id: "broad", title: "Example Diploma" })],
        { country: "Mexico", title: "Example Diploma in Testing" },
      ),
    ).toMatchObject({ id: "broad", matchMethod: "base" });
    expect(
      matchEdgeCredential(
        [credential({ id: "broad", title: "Example Diploma" })],
        { country: "Mexico", title: "Exmple Diploma" },
      ),
    ).toMatchObject({ id: "broad", matchMethod: "fuzzy" });
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

  it("maps gendered titles onto the base credential for that country", () => {
    const mexico = [
      credential({ id: "lic", title: "Licenciatura" }),
      credential({ id: "titulo", title: "Título de Licenciado" }),
      credential({ id: "ing", title: "Ingeniería" }),
      credential({ id: "mae", title: "Maestría" }),
      credential({ id: "doc", title: "Doctorado" }),
      credential({ id: "bach", title: "Bachillerato" }),
      credential({ id: "tec", title: "Técnico" }),
      credential({ id: "derecho", title: "Licenciatura en Derecho" }),
      credential({ id: "medicina", title: "Licenciatura en Medicina" }),
    ];
    const brazil = [
      credential({ id: "bacharel", title: "Bacharelado", countrySlug: "brazil", country: "Brazil" }),
      credential({ id: "lic-br", title: "Licenciatura", countrySlug: "brazil", country: "Brazil" }),
    ];
    const rows = [...mexico, ...brazil];

    expect(
      matchEdgeCredential(rows, { country: "Mexico", title: "LICENCIADA en Administración de Empresas" }),
    ).toMatchObject({ id: "lic", matchMethod: "base" });
    expect(matchEdgeCredential(rows, { country: "México", title: "Título de Licenciado" })).toMatchObject({
      id: "titulo",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "Mexico", title: "Ingeniera en Sistemas Computacionales" })).toMatchObject({
      id: "ing",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "Mexico", title: "Maestra en Educación" })).toMatchObject({
      id: "mae",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "Mexico", title: "Doctora en Ciencias" })).toMatchObject({
      id: "doc",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "Mexico", title: "Bachiller en Ciencias" })).toMatchObject({
      id: "bach",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "Mexico", title: "Técnica en Enfermería" })).toMatchObject({
      id: "tec",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "Brazil", title: "Bacharel em Engenharia" })).toMatchObject({
      id: "bacharel",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "Brazil", title: "Licenciado em Direito" })).toMatchObject({
      id: "lic-br",
      matchMethod: "base",
    });
    expect(matchEdgeCredential(rows, { country: "France", title: "LICENCIADA en Administración de Empresas" })).toBeNull();
    expect(
      matchEdgeCredential(
        [
          credential({ id: "derecho", title: "Licenciatura en Derecho" }),
          credential({ id: "medicina", title: "Licenciatura en Medicina" }),
        ],
        { country: "Mexico", title: "Licenciada en Administración de Empresas" },
      ),
    ).toBeNull();
    expect(
      matchEdgeCredential(
        [credential({ id: "lic", title: "Licenciatura" }), credential({ id: "titulo", title: "Título de Licenciado" })],
        { country: "Mexico", title: "Licenciatur" },
      ),
    ).toMatchObject({ id: "lic", matchMethod: "fuzzy" });
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
    ).toBe(PENDING_EQUIVALENCY);
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
        }).route,
    ).toBe("qa_review");
    expect(
      draftEquivalency({
        printed: "Licence",
        suggestion: equivalency({ id: "low", confidence: "low" }),
        }),
    ).toMatchObject({ usEquivalency: PENDING_EQUIVALENCY, route: "qa_research" });
    expect(
      draftEquivalency({
        printed: "Certificado",
        suggestion: null,
        }),
    ).toEqual({ usEquivalency: PENDING_EQUIVALENCY, basis: NO_EDGE_MATCH_REASON, route: "qa_research" });
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

describe("matchEdgeCredential aliases and country names", () => {
  const dr = (id: string, title: string) => credential({ id, title, countrySlug: "dominican-republic", country: "Dominican Republic" });
  const tr = (id: string, title: string) => credential({ id, title, countrySlug: "turkiye", country: "Türkiye" });
  const pk = (id: string, title: string) => credential({ id, title, countrySlug: "pakistan", country: "Pakistan" });

  it("maps native country names to the EDGE slug", () => {
    expect(countrySlug("República Dominicana")).toBe("dominican-republic");
    expect(countrySlug("Cameroun")).toBe("cameroon");
    expect(countrySlug("Republic of Ghana")).toBe("ghana");
    expect(countrySlug("Korea")).toBe("korea");
  });

  it("matches one name inside a glossed or slash-separated EDGE title", () => {
    const rows = [tr("lise", "Lise Diplomasi (General Secondary School/Lyceum Diploma)"), tr("meslek", "Meslek Lise Diplomasi (Vocational Secondary School/Lyceum Diploma)")];
    expect(matchEdgeCredential(rows, { country: "Türkiye", title: "LİSE DİPLOMASI" })?.id).toBe("lise");
  });

  it("matches an abbreviation or a title printed with Examination", () => {
    const rows = [pk("hsc", "Higher Secondary Certificate (HSC), Intermediate Certificate"), pk("ssc", "Secondary School Certificate/School Leaving Certificate")];
    expect(matchEdgeCredential(rows, { country: "Pakistan", title: "Higher Secondary Certificate Examination" })?.id).toBe("hsc");
    expect(matchEdgeCredential(rows, { country: "Pakistan", title: "HSC" })?.id).toBe("hsc");
  });

  it("repairs mojibake in catalog titles", () => {
    const rows = [dr("m", "Especialista/MaestrÃ\u00ADa"), dr("l", "Licenciatura en (field)")];
    expect(matchEdgeCredential(rows, { country: "República Dominicana", title: "Maestría" })?.id).toBe("m");
  });

  it("does not guess a field-specific row for a bare degree title", () => {
    const rows = [pk("bds", "Bachelor of Dentistry/Bachelor of Science in Dentistry (BDS)")];
    expect(matchEdgeCredential(rows, { country: "Pakistan", title: "Bachelor of Science" })).toBeNull();
    expect(matchEdgeCredential(rows, { country: "Pakistan", title: "Diploma" })).toBeNull();
  });
});

describe("matchEdgeCredential round 2", () => {
  const gh = (id: string, title: string) => credential({ id, title, countrySlug: "ghana", country: "Ghana" });
  const br = (id: string, title: string) => credential({ id, title, countrySlug: "brazil", country: "Brazil" });

  it("maps a named English bachelor's to a country's generic Bachelor's Degree row", () => {
    const rows = [gh("ba", "Bachelor's Degree"), gh("mb", "Bachelor of Medicine, Bachelor of Surgery (MB ChB)")];
    expect(matchEdgeCredential(rows, { country: "Ghana", title: "Bachelor of Arts" })?.id).toBe("ba");
  });

  it("collapses Portuguese degree forms on both sides", () => {
    const rows = [br("ms", "Título de Mestre/Grau de Mestre/Diploma de Mestrado (Master's Degree Program)"), br("dr", "Título de Doutor/Grau de Doutor/Diploma de Doutor (Doctoral Degree, PhD Degree)")];
    expect(matchEdgeCredential(rows, { country: "Brazil", title: "MESTRE EM SISTEMAS E COMPUTAÇÃO" })?.id).toBe("ms");
    expect(matchEdgeCredential(rows, { country: "Brazil", title: "Doutora em Ciências Biológicas" })?.id).toBe("dr");
  });
});
