import { mapEdgeGrade, usEquivalency } from "./grades";
import { PENDING_EQUIVALENCY } from "./equivalency";

export const US_EQUIVALENCY_LABELS = [
  "High school diploma",
  "Associate degree",
  "Bachelor's degree",
  "Master's degree",
  "Doctoral degree",
] as const;

export type EdgeGradeRow = {
  indigenousGrade: string;
  usEquivalent: string;
};

export type { EdgeGradePoints } from "./grades";

export type EdgeCredentialRecord = {
  id: string;
  countrySlug: string;
  country: string;
  title: string;
  content: string;
  levelNumber: number | null;
  levelTitle: string | null;
  url: string | null;
  usEquivalency: string | null;
};

export type EdgeGradingScaleRecord = {
  id: string;
  countrySlug: string;
  title: string;
  raw: string | null;
  rows: EdgeGradeRow[];
};

export type EdgeCredentialInsert = {
  country_slug: string;
  country: string;
  title: string;
  content: string;
  level_number: number | null;
  level_title: string | null;
  url: string | null;
  us_equivalency: string | null;
};

export type EdgeGradingScaleInsert = {
  country_slug: string;
  title: string;
  raw: string | null;
  rows: Array<{ indigenous_grade: string; us_equivalent: string }>;
};

export type EquivalencyConfidence = "high" | "medium" | "low";

export type EdgeEquivalencyRecord = {
  id: string;
  edgeCredentialId: string;
  country: string;
  credentialTitle: string;
  edgeLevel: string | null;
  usEquivalency: string;
  basis: string;
  confidence: EquivalencyConfidence;
};

export type EquivalencyRoute = "qa_review" | "qa_research";

export type EquivalencyDraft = {
  usEquivalency: string;
  basis: string | null;
  route: EquivalencyRoute;
};

const EXCERPT_CHARS = 400;

/** Slug used as edge_credentials.country_slug and as the source-object key. */
/** Native-language and short country names, keyed by slug, mapped to the EDGE slug. */
const COUNTRY_SLUG_ALIASES: Readonly<Record<string, string>> = {
  "republica-dominicana": "dominican-republic",
  "rep-dominicana": "dominican-republic",
  "cameroun": "cameroon",
  "brasil": "brazil",
  "turkey": "turkiye",
  "turquia": "turkiye",
  "mexique": "mexico",
  "espana": "spain",
  "deutschland": "germany",
  "italia": "italy",
  "nippon": "japan",
  "cote-divoire": "cote-d-ivoire",
  "ivory-coast": "cote-d-ivoire",
  "burma": "myanmar",
  "south-korea": "korea-republic-of-south-korea",
  "republic-of-korea": "korea-republic-of-south-korea",
  "uk": "united-kingdom",
  "usa": "united-states",
  "kingdom-of-saudi-arabia": "saudi-arabia",
  "peoples-republic-of-china": "china",
  "people-s-republic-of-china": "china",
  "prc": "china",
};

export function countrySlug(country: string): string {
  const slug = country
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (COUNTRY_SLUG_ALIASES[slug]) return COUNTRY_SLUG_ALIASES[slug];
  // "Republic of Ghana", "Federal Republic of Nigeria", "Islamic Republic of Pakistan".
  const stripped = slug.replace(/^(?:the-)?(?:[a-z]+-)?(?:republic|kingdom|state|sultanate|commonwealth)-of-(?:the-)?/, "");
  return COUNTRY_SLUG_ALIASES[stripped] ?? stripped;
}

/**
 * Exact slug wins. Otherwise the order slug must sit on a hyphen boundary inside
 * exactly one stored slug (prefix, suffix, or middle), so "South Korea" and
 * "Korea" can match `korea-republic-of-south-korea` without guessing between Koreas.
 */
export function resolveStoredCountrySlug(orderSlug: string, storedSlugs: readonly string[]): string | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(orderSlug)) return null;
  const unique = [...new Set(storedSlugs.filter((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)))];
  if (unique.includes(orderSlug)) return orderSlug;
  const matches = unique.filter((stored) => countrySlugOverlaps(orderSlug, stored));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** PostgREST `or` filter for slugs that contain orderSlug on a hyphen boundary. */
export function countrySlugFallbackFilter(orderSlug: string): string | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(orderSlug)) return null;
  return [
    `country_slug.like.${orderSlug}-*`,
    `country_slug.like.*-${orderSlug}`,
    `country_slug.like.*-${orderSlug}-*`,
  ].join(",");
}

function countrySlugOverlaps(orderSlug: string, stored: string): boolean {
  return (
    stored.startsWith(`${orderSlug}-`) ||
    stored.endsWith(`-${orderSlug}`) ||
    stored.includes(`-${orderSlug}-`)
  );
}

/** "MaestrÃ­a" (UTF-8 read as Latin-1) back to "Maestría". Leaves clean text alone. */
function repairMojibake(value: string): string {
  if (!/[ÃÂ][\u0080-\u00ff]/.test(value)) return value;
  const codes = Array.from(value, (char) => char.charCodeAt(0));
  if (codes.some((code) => code > 0xff)) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(codes));
  } catch {
    return value;
  }
}

export function normalizeCredentialTitle(title: string): string {
  return repairMojibake(title)
    .replace(/[®™©]/g, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Longer phrases first so "titulo de licenciado" is not partly rewritten as "titulo de licenciatura". */
const DEGREE_FORMS: ReadonlyArray<readonly [string, string]> = [
  ["titulo de licenciatura", "licenciatura"],
  ["titulo de licenciada", "licenciatura"],
  ["titulo de licenciado", "licenciatura"],
  ["licenciada", "licenciatura"],
  ["licenciado", "licenciatura"],
  ["titulo de ingenieria", "ingenieria"],
  ["titulo de ingeniera", "ingenieria"],
  ["titulo de ingeniero", "ingenieria"],
  ["ingeniera", "ingenieria"],
  ["ingeniero", "ingenieria"],
  ["titulo de maestria", "maestria"],
  ["titulo de maestra", "maestria"],
  ["titulo de maestro", "maestria"],
  ["maestra", "maestria"],
  ["maestro", "maestria"],
  ["titulo de doctorado", "doctorado"],
  ["titulo de doctora", "doctorado"],
  ["titulo de doctor", "doctorado"],
  ["doctorado", "doctorado"],
  ["doctora", "doctorado"],
  ["doctor", "doctorado"],
  ["titulo de bachillerato", "bachillerato"],
  ["titulo de bachillera", "bachillerato"],
  ["titulo de bachiller", "bachillerato"],
  ["bachillerato", "bachillerato"],
  ["bachillera", "bachillerato"],
  ["bachiller", "bachillerato"],
  ["titulo de tecnica", "tecnico"],
  ["titulo de tecnico", "tecnico"],
  ["tecnica", "tecnico"],
  ["tecnico", "tecnico"],
  ["bacharela", "bacharelado"],
  ["bacharel", "bacharelado"],
  ["titulo de bacharel", "bacharelado"],
  ["grau de bacharel", "bacharelado"],
  ["titulo de mestre", "mestrado"],
  ["grau de mestre", "mestrado"],
  ["diploma de mestrado", "mestrado"],
  ["mestra", "mestrado"],
  ["mestre", "mestrado"],
  ["titulo de doutor", "doutorado"],
  ["grau de doutor", "doutorado"],
  ["diploma de doutor", "doutorado"],
  ["doutora", "doutorado"],
  ["doutor", "doutorado"],
];

const DEGREE_FORM_PATTERN = new RegExp(
  `\\b(?:${[...DEGREE_FORMS]
    .sort((left, right) => right[0].length - left[0].length)
    .map(([form]) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"))
    .join("|")})\\b`,
  "g",
);

const DEGREE_BASE = new Map(DEGREE_FORMS);

const FIELD_PHRASE = /\s+(?:en|em|in|de)\s+.+$/;

/**
 * One comparable title: normalized text, gendered and noun variants collapsed,
 * then a trailing field phrase removed. "LICENCIADA en Administración de Empresas"
 * and "Título de Licenciado" both become "licenciatura".
 */
export function baseCredentialTitle(title: string): string {
  DEGREE_FORM_PATTERN.lastIndex = 0;
  const mapped = normalizeCredentialTitle(title).replace(DEGREE_FORM_PATTERN, (match) => {
    const key = match.replace(/\s+/g, " ");
    return DEGREE_BASE.get(key) ?? match;
  });
  const dropped = mapped.replace(FIELD_PHRASE, "").trim();
  return dropped || mapped;
}

export function mapEdgeCredentialRow(row: Record<string, unknown>): EdgeCredentialRecord | null {
  const id = text(row.id);
  const countrySlugValue = text(row.country_slug);
  const country = text(row.country);
  const title = text(row.title);
  if (!id || !countrySlugValue || !country || !title) return null;
  const levelNumber = typeof row.level_number === "number" && Number.isFinite(row.level_number) ? row.level_number : null;
  return {
    id,
    countrySlug: countrySlugValue,
    country,
    title,
    content: text(row.content) ?? "",
    levelNumber,
    levelTitle: text(row.level_title),
    url: text(row.url),
    usEquivalency: text(row.us_equivalency),
  };
}

export function mapEdgeGradingScaleRow(row: Record<string, unknown>): EdgeGradingScaleRecord | null {
  const id = text(row.id);
  const countrySlugValue = text(row.country_slug);
  const title = text(row.title);
  if (!id || !countrySlugValue || !title) return null;
  const rows = Array.isArray(row.rows) ? row.rows.flatMap(storedGradeRow) : [];
  return {
    id,
    countrySlug: countrySlugValue,
    title,
    raw: text(row.raw),
    rows,
  };
}

function storedGradeRow(entry: unknown): EdgeGradeRow[] {
  if (!entry || typeof entry !== "object") return [];
  const row = entry as Record<string, unknown>;
  const indigenous = text(row.indigenous_grade);
  const equivalent = text(row.us_equivalent);
  if (!indigenous || !equivalent) return [];
  return [{ indigenousGrade: indigenous, usEquivalent: equivalent }];
}

export function edgeContentExcerpt(content: string, max = EXCERPT_CHARS): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

export function safeEdgeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function canonicalUsEquivalency(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === PENDING_EQUIVALENCY) return null;
  const exact = US_EQUIVALENCY_LABELS.find((label) => label.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  return usEquivalency(trimmed);
}

/**
 * One country group from the licensed source, which is not stored in the repo.
 * The object key is the country slug when it is already lowercase and hyphenated.
 * Otherwise the slug is countrySlug(country), then countrySlug(key).
 */
export function edgeRowsFromSource(source: unknown): {
  credentials: EdgeCredentialInsert[];
  gradingScales: EdgeGradingScaleInsert[];
} {
  const credentials: EdgeCredentialInsert[] = [];
  const gradingScales: EdgeGradingScaleInsert[] = [];
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { credentials, gradingScales };
  }
  for (const [key, group] of Object.entries(source as Record<string, unknown>)) {
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const record = group as Record<string, unknown>;
    const countryName = text(record.country) || key.trim();
    const slug = slugFromKey(key, countryName);
    if (!slug || !countryName) continue;
    const credentialRows = Array.isArray(record.credentials) ? record.credentials : [];
    for (const entry of credentialRows) {
      const row = credentialInsert(slug, countryName, entry);
      if (row) credentials.push(row);
    }
    const scaleRows = Array.isArray(record.grading_scales) ? record.grading_scales : [];
    for (const entry of scaleRows) {
      const row = scaleInsert(slug, entry);
      if (row) gradingScales.push(row);
    }
  }
  return { credentials, gradingScales };
}

export type CredentialMatchMethod = "base" | "fuzzy";

export type EdgeCredentialMatch = EdgeCredentialRecord & {
  matchMethod: CredentialMatchMethod;
};

export function matchEdgeCredential(
  rows: readonly EdgeCredentialRecord[],
  input: { country: string; title: string },
): EdgeCredentialMatch | null {
  const normalized = normalizeCredentialTitle(input.title);
  const base = baseCredentialTitle(input.title);
  if (!normalized || !base || input.country === PENDING_EQUIVALENCY) return null;
  const pool = rowsForCountry(rows, input.country);
  if (pool.length === 0) return null;

  const exact = pool.filter((row) => normalizeCredentialTitle(row.title) === normalized);
  if (exact.length > 0) return tagged(preferCredentialId(exact), "base");

  const baseHits = pool.filter((row) => baseCredentialTitle(row.title) === base);
  if (baseHits.length > 0) {
    const chosen = pickBaseCredential(baseHits, base);
    return chosen ? tagged(chosen, "base") : null;
  }

  // A bare "Diploma" or "Certificate" says nothing about the level. Leave it for staff.
  const printedGeneric = genericDegreeKey(normalized);
  if (BARE_TITLES.has(normalized.replace(/\s*\b(?:hons?|honours|honors)\b/g, "").trim())) return null;

  // EDGE packs several names into one title: "Bachiller / Bachillerato",
  // "Higher Secondary Certificate (HSC)", "Licence/Bachelor's degree".
  // Printed form first, then the collapsed base form.
  for (const keys of [[normalized, stripExamination(normalized), printedGeneric], [base]]) {
    const wanted = new Set(keys.filter(Boolean));
    const aliasHits = pool.filter((row) => credentialAliases(row.title).some((alias) => wanted.has(alias)));
    if (aliasHits.length === 1) return tagged(aliasHits[0]!, "base");
    if (aliasHits.length > 1) return null;
  }

  // A bare "Bachelor of Science" says nothing about the field. Do not fuzzy it
  // onto "Bachelor of Science in Dentistry"; leave it for staff.
  if (GENERIC_DEGREE_KEYS.has(printedGeneric)) return null;

  const ranked = pool
    .map((row) => ({
      row,
      score: Math.max(
        titleScore(normalized, normalizeCredentialTitle(row.title)),
        titleScore(base, baseCredentialTitle(row.title)),
        ...credentialAliases(row.title).map((alias) => titleScore(stripExamination(normalized), alias)),
      ),
    }))
    .filter((item) => item.score >= 0.8)
    .sort((a, b) => b.score - a.score || b.row.title.length - a.row.title.length);
  const best = ranked[0];
  if (!best) return null;
  const close = ranked.filter((item) => best.score - item.score < 0.05);
  if (close.length === 1) return tagged(best.row, "fuzzy");
  const bases = new Set(close.map((item) => baseCredentialTitle(item.row.title)));
  if (bases.size !== 1) return null;
  const shared = [...bases][0];
  if (!shared) return null;
  const chosen = pickBaseCredential(
    close.map((item) => item.row),
    shared,
  );
  return chosen ? tagged(chosen, "fuzzy") : null;
}

const GENERIC_DEGREE_KEYS = new Set(["bachelor", "master"]);
const BARE_TITLES = new Set(["diploma", "certificate", "degree", "bachelor", "master"]);

/** "Bachelor of Science", "Bachelor's Degree", "Bachelors" → "bachelor". Other titles pass through. */
function genericDegreeKey(normalized: string): string {
  const value = normalized.replace(/\s*\b(?:hons?|honours|honors)\b/g, "").trim();
  if (/^(?:bachelor s degree|bachelors degree|bachelor degree|bachelors?|bachelor of (?:arts|science|sciences))$/.test(value)) return "bachelor";
  if (/^(?:master s degree|masters degree|master degree|masters?|master of (?:arts|science|sciences))$/.test(value)) return "master";
  return value;
}

function stripExamination(normalized: string): string {
  return normalized.replace(/\s+(?:examination|exam|examinations)$/, "").trim();
}

function credentialAliases(title: string): string[] {
  const out = new Set<string>();
  const clean = repairMojibake(title);
  for (const inner of clean.match(/\(([^)]+)\)/g) ?? []) {
    const value = inner.slice(1, -1).trim();
    // Abbreviations such as (HSC), (WASSCE), (CSEC). Not qualifiers like (traditional).
    if (/^[A-Z][A-Z.\-]{1,9}$/.test(value)) out.add(normalizeCredentialTitle(value));
  }
  const withoutGloss = clean.replace(/\([^)]*\)/g, " ");
  for (const part of withoutGloss.split(/\s*\/\s*|\s+or\s+|\s+OR\s+|\s*;\s*|,\s+/)) {
    const normalized = normalizeCredentialTitle(part);
    if (normalized.length < 3) continue;
    out.add(normalized);
    out.add(stripExamination(normalized));
    // Collapsed degree form ("Título de Mestre" → "mestrado"), but never by dropping a field:
    // "Bachelor of Science in Dentistry" must not become plain "bachelor of science".
    DEGREE_FORM_PATTERN.lastIndex = 0;
    const mapped = normalized.replace(DEGREE_FORM_PATTERN, (match) => DEGREE_BASE.get(match.replace(/\s+/g, " ")) ?? match);
    if (!FIELD_PHRASE.test(mapped)) out.add(mapped);
    if (/^(?:bachelor s degree|bachelors degree|bachelors?|master s degree|masters degree|masters?)$/.test(normalized)) {
      out.add(genericDegreeKey(normalized));
    }
  }
  return [...out].filter(Boolean);
}

function tagged(row: EdgeCredentialRecord, matchMethod: CredentialMatchMethod): EdgeCredentialMatch {
  return { ...row, matchMethod };
}

function preferCredentialId(rows: readonly EdgeCredentialRecord[]): EdgeCredentialRecord {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))[0]!;
}

/** The generic base title wins. Several field-specific rows and no generic title stay unmatched. */
function pickBaseCredential(rows: readonly EdgeCredentialRecord[], base: string): EdgeCredentialRecord | null {
  const canonical = rows.filter((row) => normalizeCredentialTitle(row.title) === base);
  if (canonical.length > 0) return preferCredentialId(canonical);
  if (rows.length === 1) return rows[0] ?? null;
  return null;
}

export function matchEdgeGradingScale(
  scales: readonly EdgeGradingScaleRecord[],
  input: { country: string; title: string; grades: readonly string[] },
): EdgeGradingScaleRecord | null {
  if (input.country === PENDING_EQUIVALENCY) return null;
  const pool = rowsForCountry(scales, input.country);
  if (pool.length === 0) return null;
  const grades = input.grades.map((grade) => grade.trim()).filter(Boolean);
  if (grades.length === 0) {
    if (pool.length === 1) return pool[0] ?? null;
    return matchScaleByCredential(pool, input.title);
  }

  const ranked = pool
    .map((scale) => ({
      scale,
      hits: grades.filter((grade) => mapEdgeGrade(grade, scale.rows) != null).length,
    }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const best = ranked[0];
  const next = ranked[1];
  if (!best) return null;
  if (next && best.hits === next.hits) return null;
  return best.scale;
}

export function staffEdgeView(input: {
  credential: EdgeCredentialRecord | null;
  scale: EdgeGradingScaleRecord | null;
}): {
  title: string;
  levelNumber: number | null;
  levelTitle: string | null;
  contentExcerpt: string;
  url: string | null;
  gradingScale: { title: string; rows: EdgeGradeRow[] } | null;
} | null {
  if (!input.credential && !input.scale) return null;
  return {
    title: input.credential?.title ?? input.scale?.title ?? "",
    levelNumber: input.credential?.levelNumber ?? null,
    levelTitle: input.credential?.levelTitle ?? null,
    contentExcerpt: edgeContentExcerpt(input.credential?.content ?? ""),
    url: safeEdgeUrl(input.credential?.url ?? null),
    gradingScale: input.scale ? { title: input.scale.title, rows: input.scale.rows } : null,
  };
}

export function chooseEquivalency(input: {
  matched: boolean;
  edgeUsEquivalency: string | null;
  ai: { usEquivalency: string; confident: boolean } | null;
  printed: string;
}): string {
  if (!input.matched) return usEquivalency(input.printed) ?? PENDING_EQUIVALENCY;
  if (input.ai?.confident) {
    const proposed = canonicalUsEquivalency(input.ai.usEquivalency);
    if (proposed) return proposed;
  }
  return canonicalUsEquivalency(input.edgeUsEquivalency) ?? PENDING_EQUIVALENCY;
}

const CONFIDENCE_RANK: Record<EquivalencyConfidence, number> = { high: 3, medium: 2, low: 1 };

export function mapEdgeEquivalencyRow(row: Record<string, unknown>): EdgeEquivalencyRecord | null {
  const id = text(row.id);
  const edgeCredentialId = text(row.edge_credential_id);
  const country = text(row.country);
  const credentialTitle = text(row.credential_title);
  const usEquivalencyValue = text(row.us_equivalency);
  const basis = text(row.basis);
  const confidence = text(row.confidence);
  if (!id || !edgeCredentialId || !country || !credentialTitle || !usEquivalencyValue || !basis) return null;
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") return null;
  return {
    id,
    edgeCredentialId,
    country,
    credentialTitle,
    edgeLevel: text(row.edge_level),
    usEquivalency: usEquivalencyValue,
    basis,
    confidence,
  };
}

/** Highest confidence wins. A tie keeps the first row in that band. */
export function pickEdgeEquivalency(rows: readonly EdgeEquivalencyRecord[]): EdgeEquivalencyRecord | null {
  const ranked = [...rows].sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]);
  return ranked[0] ?? null;
}

/**
 * Prefer the matched credential. A single-credential order can fall back to the
 * id already stored on the order when this pass does not match a title.
 */
export function equivalencyCredentialId(input: {
  matchedId: string | null;
  storedId: string | null;
  singleCredential: boolean;
}): string | null {
  if (input.matchedId) return input.matchedId;
  if (input.singleCredential && input.storedId) return input.storedId;
  return null;
}

export function draftEquivalency(input: {
  printed: string;
  suggestion: EdgeEquivalencyRecord | null;
  fallback: string;
}): EquivalencyDraft {
  if (!input.suggestion) {
    return { usEquivalency: input.fallback, basis: null, route: "qa_research" };
  }
  const label = canonicalUsEquivalency(input.suggestion.usEquivalency) ?? input.fallback;
  const usable = label !== PENDING_EQUIVALENCY;
  const confident = input.suggestion.confidence === "high" || input.suggestion.confidence === "medium";
  return {
    usEquivalency: label,
    basis: input.suggestion.basis.trim() || null,
    route: usable && confident ? "qa_review" : "qa_research",
  };
}

export function combineEquivalencyRoutes(routes: readonly EquivalencyRoute[]): EquivalencyRoute {
  if (routes.length > 0 && routes.every((route) => route === "qa_review")) return "qa_review";
  return "qa_research";
}

export function edgeEquivalencyPrompt(input: {
  country: string;
  printedTitle: string;
  edgeTitle: string;
  levelNumber: number | null;
  levelTitle: string | null;
  contentExcerpt: string;
  usEquivalencyHint: string | null;
  gradingRows: readonly EdgeGradeRow[];
}): string {
  const level = [input.levelNumber != null ? `number ${input.levelNumber}` : null, input.levelTitle]
    .filter(Boolean)
    .join(", ");
  const rows = input.gradingRows
    .slice(0, 30)
    .map((row) => `${row.indigenousGrade} = ${row.usEquivalent}`)
    .join("\n");
  return `Propose one U.S. equivalency for this foreign credential.
Choose only one of: ${US_EQUIVALENCY_LABELS.join("; ")}.
Set confident to true only when the EDGE level supports that label. Otherwise return an empty usEquivalency and confident false.
Do not invent a degree that the EDGE entry does not support.

Printed credential: ${input.printedTitle}
Country: ${input.country}
EDGE title: ${input.edgeTitle}
EDGE level: ${level || "(none)"}
EDGE note: ${input.usEquivalencyHint?.trim() || "(none)"}
EDGE excerpt: ${input.contentExcerpt || "(none)"}
Grading rows:
${rows || "(none)"}`;
}

function rowsForCountry<T extends { countrySlug: string }>(rows: readonly T[], country: string): T[] {
  const slug = countrySlug(country);
  if (!slug) return [];
  const resolved = resolveStoredCountrySlug(
    slug,
    rows.map((row) => row.countrySlug),
  );
  if (!resolved) return [];
  return rows.filter((row) => row.countrySlug === resolved);
}

const SCALE_TITLE_SEPARATOR = /\s+[—–]\s+/;

function matchScaleByCredential(
  pool: readonly EdgeGradingScaleRecord[],
  title: string,
): EdgeGradingScaleRecord | null {
  const printed = normalizeCredentialTitle(title);
  if (!printed) return null;
  const ranked = pool
    .map((scale) => ({ scale, score: scaleLabelScore(printed, scale) }))
    .filter((item) => item.score >= 0.8)
    .sort((a, b) => b.score - a.score || b.scale.title.length - a.scale.title.length);
  const best = ranked[0];
  const next = ranked[1];
  if (!best) return null;
  if (next && best.score - next.score < 0.05) return null;
  return best.scale;
}

function scaleLabelScore(printed: string, scale: EdgeGradingScaleRecord): number {
  return scaleSearchTexts(scale).reduce((best, text) => {
    const reference = normalizeCredentialTitle(text);
    const score = titleScore(printed, reference);
    if (reference.length >= 8 && printed.startsWith(`${reference} `)) return Math.max(best, score, 0.95);
    return Math.max(best, score);
  }, 0);
}

function scaleSearchTexts(scale: EdgeGradingScaleRecord): string[] {
  const segments = scale.title
    .split(SCALE_TITLE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  const texts = [scale.title, ...segments];
  if (scale.raw) texts.push(scale.raw);
  return texts;
}

function slugFromKey(key: string, countryName: string): string {
  const trimmed = key.trim();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) return trimmed;
  return countrySlug(countryName) || countrySlug(trimmed);
}

function credentialInsert(slug: string, country: string, entry: unknown): EdgeCredentialInsert | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const title = text(row.title);
  if (!title) return null;
  const level = row.level && typeof row.level === "object" ? (row.level as Record<string, unknown>) : {};
  const levelNumber = typeof level.number === "number" && Number.isFinite(level.number) ? Math.trunc(level.number) : null;
  return {
    country_slug: slug,
    country,
    title,
    content: text(row.content) ?? "",
    level_number: levelNumber,
    level_title: text(level.title),
    url: text(row.url),
    us_equivalency: text(row.us_equivalency),
  };
}

function scaleInsert(slug: string, entry: unknown): EdgeGradingScaleInsert | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const title = text(row.title);
  if (!title) return null;
  const rows = Array.isArray(row.rows) ? row.rows.flatMap(gradeRow) : [];
  return {
    country_slug: slug,
    title,
    raw: text(row.raw),
    rows,
  };
}

function gradeRow(entry: unknown): Array<{ indigenous_grade: string; us_equivalent: string }> {
  if (!entry || typeof entry !== "object") return [];
  const row = entry as Record<string, unknown>;
  const indigenous = text(row.indigenous_grade);
  const equivalent = text(row.us_equivalent);
  if (!indigenous || !equivalent) return [];
  return [{ indigenous_grade: indigenous, us_equivalent: equivalent }];
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function titleScore(printed: string, reference: string): number {
  if (!printed || !reference) return 0;
  if (printed === reference) return 1;
  const left = printed.split(" ");
  const right = reference.split(" ");
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  let score = jaccard(left, right);
  if (shorter.join(" ").length >= 8 && containsSequence(longer, shorter)) {
    score = Math.max(score, 0.9);
  }
  const max = Math.max(printed.length, reference.length);
  const similar = max === 0 ? 0 : 1 - levenshtein(printed, reference) / max;
  if (similar >= 0.88) score = Math.max(score, similar);
  const grams = trigramDice(printed, reference);
  if (grams >= 0.8) score = Math.max(score, grams);
  return score;
}

function trigramDice(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = characterTrigrams(left);
  const b = characterTrigrams(right);
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const gram of a) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of b) {
    const remaining = counts.get(gram) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(gram, remaining - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function characterTrigrams(value: string): string[] {
  const grams: string[] = [];
  for (let index = 0; index <= value.length - 3; index += 1) grams.push(value.slice(index, index + 3));
  return grams;
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  let index = 0;
  for (const token of haystack) {
    if (token === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function levenshtein(left: string, right: string): number {
  const a = left.slice(0, 80);
  const b = right.slice(0, 80);
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) rows[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}
