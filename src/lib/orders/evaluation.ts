import { z } from "zod";
import { generateObject } from "./ai";
import { LOW_LANGUAGE_CONFIDENCE, FINALS_BUCKET, PREVIEWS_BUCKET, SPARSE_PAGE_WORDS } from "./constants";
import {
  orderCustomerEmail,
  insertEvent,
  insertPreview,
  listDocuments,
  listEdgeCredentialsForCountry,
  listEdgeEquivalenciesForCredential,
  listEdgeGradingScalesForCountry,
  resolveEdgeCountrySlug,
  listPages,
  markPreview,
  nextPreviewVersion,
  updateOrder,
  type Db,
} from "./db";
import { sendPreviewReady } from "./email";
import { AiUnavailableError, HttpError } from "./errors";
import { needsBundledTranslation } from "./evaluation-price";
import { paidEvaluationDegreeCount } from "./evaluation-summary";
import {
  courseExtractFromTranscript,
  recoverCourseExtract,
  stripApplicantRegistration,
  textForPaidEvaluation,
  type TranscriptRowFailure,
} from "./evaluation-transcript";
import { evaluationServicePath } from "./evaluation-summary";
import { orderEvaluationKinds, orderHasEvaluation, resolveServices, selectionPricePatch } from "./service-selection";
import { concatPdfs } from "./pdf/merge";
import { etaFromNow } from "./quote";
import {
  EQUIVALENCY_QA_RESEARCH,
  PENDING_EQUIVALENCY,
  awaitingEquivalencyPublish,
  diplomaEquivalencyPending,
} from "./equivalency";
import {
  combineEquivalencyRoutes,
  countrySlug,
  draftEquivalency,
  equivalencyCredentialId,
  matchEdgeCredential,
  matchEdgeGradingScale,
  pickEdgeEquivalency,
  type CredentialMatchMethod,
  type EdgeCredentialMatch,
  type EdgeCredentialRecord,
  type EdgeEquivalencyRecord,
  type EdgeGradingScaleRecord,
  type EquivalencyDraft,
  type EquivalencyRoute,
} from "./edge";
import {
  EDGE_GRADE_SCALE_TEXT,
  credentialWasPassed,
  gradeScaleText,
  scoreCourses,
  type RawCourse,
} from "./grades";
import { IMAGE_QUALITY_REASON } from "./image-quality";
import { evaluationIssuedLabel, evaluationReportId, renderEvaluationPdfs } from "./pdf/evaluation";
import { stampFinishedPdf } from "./verification";
import { uploadObject } from "./storage";
import { countWords } from "./words";
import { watermarkedTranslationPreview } from "./translation";
import type { EvaluationResult, EvaluationService, OrderRecord, StoredPageOrder } from "./types";

export const UNMAPPED_REASON = "The credential or a grade could not be mapped to a U.S. equivalent.";

/** Watermarked evaluation report and the certified-translation preview beside it. Same version in both names. */
export function evaluationPreviewObjects(orderId: string, version: number): {
  reportPath: string;
  translationPreviewPath: string;
} {
  return {
    reportPath: `${orderId}/report-v${version}.pdf`,
    translationPreviewPath: `${orderId}/translation-preview-v${version}.pdf`,
  };
}

/**
 * Preview rows are unique on (order_id, version), so the translation object
 * cannot share the report's row. The filename still uses the report version.
 */
export function translationPreviewRecord(input: {
  orderId: string;
  reportVersion: number;
  rowVersion: number;
}): { version: number; previewPath: string } {
  if (input.rowVersion <= input.reportVersion) {
    throw new Error("A translation preview needs its own preview version");
  }
  return {
    version: input.rowVersion,
    previewPath: evaluationPreviewObjects(input.orderId, input.reportVersion).translationPreviewPath,
  };
}

/** Bytes stored as `translation-preview-v`. The watermarked pass only; never the clean file. */
export function translationPreviewBytes(files: { watermarkedPreview: Uint8Array }): Uint8Array {
  return files.watermarkedPreview;
}
const LANGUAGE_REASON = "The source language could not be confirmed.";
const READ_REASON = "The evaluation could not be read.";

const diplomaSchema = z.object({
  credentials: z.array(
    z.object({
      applicant: z.string(),
      institution: z.string(),
      country: z.string(),
      credential: z.string(),
      /** English name of the credential when the printed title is not in English or not in Latin script. */
      englishCredential: z.string().optional(),
      field: z.string(),
      dates: z.string(),
    }),
  ),
});

const courseSchema = z.object({
  applicant: z.string(),
  institution: z.string(),
  country: z.string(),
  credential: z.string(),
  englishCredential: z.string().optional(),
  scale: z.enum(["10", "20", "100", "4", "roman", "letter"]),
  /** Overall decision as printed, such as Admis or Ajourné. Empty when the document does not state one. */
  result: z.string().optional(),
  years: z.array(
    z.object({
      year: z.string(),
      courses: z.array(
        z.object({
          originalName: z.string(),
          englishName: z.string(),
          localCredits: z.number(),
          localGrade: z.string(),
        }),
      ),
    }),
  ),
});

export type DiplomaExtract = z.infer<typeof diplomaSchema>;
export type CourseExtract = z.infer<typeof courseSchema>;

function filled(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** "Licenciada en Administración de Empresas" → the subject, when field was left blank. */
function subjectFromTitle(credential: string): string | null {
  const match = credential.match(/\ben\s+(.+)$/i);
  return filled(match?.[1] ?? "");
}

function orPending(value: string, fallback = ""): string {
  return filled(value) ?? filled(fallback) ?? PENDING_EQUIVALENCY;
}

function foldLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

const FRENCH_MONTHS: Readonly<Record<string, string>> = {
  janvier: "January",
  fevrier: "February",
  mars: "March",
  avril: "April",
  mai: "May",
  juin: "June",
  juillet: "July",
  aout: "August",
  septembre: "September",
  octobre: "October",
  novembre: "November",
  decembre: "December",
};

const FRENCH_COUNTRIES: Readonly<Record<string, string>> = {
  cameroun: "Cameroon",
  cameroon: "Cameroon",
  france: "France",
  mexique: "Mexico",
  mexico: "Mexico",
  espagne: "Spain",
  spain: "Spain",
  italie: "Italy",
  italy: "Italy",
  allemagne: "Germany",
  germany: "Germany",
  bresil: "Brazil",
  brazil: "Brazil",
  belgique: "Belgium",
  belgium: "Belgium",
  suisse: "Switzerland",
  switzerland: "Switzerland",
  maroc: "Morocco",
  morocco: "Morocco",
  tunisie: "Tunisia",
  tunisia: "Tunisia",
  algerie: "Algeria",
  algeria: "Algeria",
  senegal: "Senegal",
  haiti: "Haiti",
  liban: "Lebanon",
  lebanon: "Lebanon",
  chine: "China",
  china: "China",
  japon: "Japan",
  japan: "Japan",
  "republique dominicaine": "Dominican Republic",
  "dominican republic": "Dominican Republic",
  "cote d'ivoire": "Côte d'Ivoire",
  "cote divoire": "Côte d'Ivoire",
};

/** French field labels that show up in all caps on Cameroonian and French credentials. */
const FRENCH_FIELDS: Readonly<Record<string, string>> = {
  "techniques quantitatives de gestion": "Quantitative Management Techniques",
  "sciences economiques et juridiques": "Economic and Legal Sciences",
  "mathematiques appliquees": "Applied Mathematics",
};

const FRENCH_COURSES: Readonly<Record<string, string>> = {
  "sciences economiques et juridiques": "Economic and Legal Sciences",
  "mathematiques appliquees": "Applied Mathematics",
  "techniques quantitatives de gestion": "Quantitative Management Techniques",
  "pratique professionnelle (pratique ecrite)": "Professional Practice (Written)",
  "pratique professionnelle (sur materiel)": "Professional Practice (Practical)",
  francais: "French",
  philosophie: "Philosophy",
  anglais: "English",
  "education civique": "Civics",
  mathematiques: "Mathematics",
  "histoire ou geographie": "History or Geography",
  histoire: "History",
  chimie: "Chemistry",
  physique: "Physics",
  latin: "Latin",
  algebre: "Algebra",
  biologie: "Biology",
  sport: "Sport",
  "comptabilite analytique": "Cost Accounting",
};

const FRENCH_COURSE_WORD =
  /\b(et|ou|de|du|des|la|le|les|aux|sur|appliquee|appliquees|applique|appliques|economique|economiques|juridique|juridiques|mathematique|mathematiques|francais|physique|chimie|histoire|geographie|gestion|quantitatives|pratique|professionnelle|professionnel|civique|algebre|philosophie|anglais|comptabilite|analytique)\b/;

function titleCaseEnglish(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (_, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`);
}

function presentEnglishTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === trimmed.toUpperCase() || trimmed === trimmed.toLowerCase()) return titleCaseEnglish(trimmed);
  return trimmed;
}

/** A title that is already English, so it does not need another translation pass. */
export function isEnglishCourseTitle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/[\u0300-\u036f]/.test(trimmed.normalize("NFD"))) return false;
  return !FRENCH_COURSE_WORD.test(foldLabel(trimmed));
}

/** Country of education in English. `Cameroun` and `République du Cameroun` become `Cameroon`. */
export function normalizeEvaluationCountry(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const folded = foldLabel(trimmed).replace(/[^a-z'\s-]/g, " ").replace(/\s+/g, " ").trim();
  if (FRENCH_COUNTRIES[folded]) return FRENCH_COUNTRIES[folded];
  if (folded.includes("cameroun") || folded.includes("cameroon")) return "Cameroon";
  if (folded.includes("republique dominicaine") || folded.includes("dominican republic")) return "Dominican Republic";
  if (folded.includes("cote d'ivoire") || folded.includes("cote divoire")) return "Côte d'Ivoire";
  return trimmed;
}

/**
 * Conferral and examination dates in English.
 * `26 Mars 2003` becomes `March 26, 2003`. A date that is already English, or a year range, stays as written.
 */
export function normalizeEvaluationDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const folded = foldLabel(trimmed);
  const match = folded.match(
    /(?:^|\s)(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})(?!\d)/,
  );
  if (!match) return trimmed;
  const day = Number(match[1]);
  const month = FRENCH_MONTHS[match[2] ?? ""];
  if (!month || day < 1 || day > 31) return trimmed;
  return `${month} ${day}, ${match[3]}`;
}

/** Subject in English Title Case. A known French label is translated; an English label is kept. */
export function normalizeEvaluationField(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const known = FRENCH_FIELDS[foldLabel(trimmed)];
  if (known) return known;
  if (isEnglishCourseTitle(trimmed) && (trimmed === trimmed.toUpperCase() || trimmed === trimmed.toLowerCase())) {
    return titleCaseEnglish(trimmed);
  }
  return trimmed;
}

/** English course title. A translation that is already English wins. Otherwise a known French title is translated. */
export function englishNameForCourse(originalName: string, englishName: string): string {
  const original = originalName.trim();
  const english = englishName.trim();
  if (english && foldLabel(english) !== foldLabel(original) && isEnglishCourseTitle(english)) {
    return presentEnglishTitle(english);
  }
  const known = FRENCH_COURSES[foldLabel(original)];
  if (known) return known;
  if (isEnglishCourseTitle(original)) return presentEnglishTitle(original);
  return english || original;
}

const courseNameSchema = z.object({
  names: z.array(
    z.object({
      originalName: z.string(),
      englishName: z.string(),
    }),
  ),
});

const COURSE_NAME_INSTRUCTIONS = `Translate each course title into English.
Copy originalName exactly from the input.
englishName is the accurate English course title in Title Case.
When the title is already English, englishName is that title in Title Case.
Do not add or drop courses. Do not include grades or credits.`;

type CourseNameSource = {
  country: string;
  years: Array<{
    year: string;
    courses: Array<{ originalName: string; englishName: string; localCredits: number; localGrade: string }>;
  }>;
};

/** Fills `englishName` from a known translation or the model. Grades and the printed `originalName` stay put. */
export async function withEnglishCourseNames<T extends CourseNameSource>(extracted: T): Promise<T> {
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const year of extracted.years) {
    for (const course of year.courses) {
      const original = course.originalName.trim();
      const key = foldLabel(original);
      if (!original || seen.has(key)) continue;
      seen.add(key);
      const resolved = englishNameForCourse(original, course.englishName);
      if (foldLabel(resolved) === key && !isEnglishCourseTitle(resolved)) pending.push(original);
    }
  }
  const translated = new Map<string, string>();
  if (pending.length > 0) {
    try {
      const result = await generateObject(
        courseNameSchema,
        [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${COURSE_NAME_INSTRUCTIONS}\n\n${pending.map((name) => `- ${name}`).join("\n")}`,
              },
            ],
          },
        ],
        undefined,
        { lowReasoning: true },
      );
      for (const row of result.names) {
        const key = foldLabel(row.originalName);
        const value = row.englishName.trim();
        if (key && value && isEnglishCourseTitle(value)) translated.set(key, presentEnglishTitle(value));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : "course name translation failed");
    }
  }
  return {
    ...extracted,
    country: normalizeEvaluationCountry(extracted.country),
    years: extracted.years.map((year) => ({
      ...year,
      courses: year.courses.map((course) => {
        const fromModel = translated.get(foldLabel(course.originalName));
        return {
          ...course,
          englishName: fromModel ?? englishNameForCourse(course.originalName, course.englishName),
        };
      }),
    })),
  };
}

export function normalizeDiplomaExtract(extracted: DiplomaExtract): DiplomaExtract {
  return {
    credentials: extracted.credentials.map((item) => ({
      ...item,
      applicant: stripApplicantRegistration(item.applicant),
      country: normalizeEvaluationCountry(item.country),
      field: normalizeEvaluationField(item.field),
      dates: normalizeEvaluationDate(item.dates),
    })),
  };
}

export function assembleDiploma(input: {
  extracted: DiplomaExtract;
  degreeCount: number;
  documentsReviewed: string[];
  equivalencies?: Array<string | null | undefined>;
  bases?: Array<string | null | undefined>;
}): EvaluationResult | null {
  if (input.extracted.credentials.length !== input.degreeCount) return null;
  if (input.documentsReviewed.length === 0) return null;
  const credentials = [];
  for (const [index, item] of input.extracted.credentials.entries()) {
    const applicant = filled(stripApplicantRegistration(item.applicant));
    const institution = filled(item.institution);
    const credential = filled(item.credential);
    if (!applicant || !institution || !credential) return null;
    credentials.push({
      applicant,
      institution,
      country: orPending(normalizeEvaluationCountry(item.country)),
      credential,
      field: orPending(
        normalizeEvaluationField(item.field),
        normalizeEvaluationField(subjectFromTitle(credential) ?? ""),
      ),
      dates: orPending(normalizeEvaluationDate(item.dates)),
      usEquivalency: input.equivalencies?.[index] ?? PENDING_EQUIVALENCY,
      ...(input.bases?.[index]?.trim() ? { equivalencyBasis: input.bases[index]?.trim() } : {}),
      documentsReviewed: input.documentsReviewed,
    });
  }
  return { kind: "diploma", credentials };
}

function staffValue(stored: string, submitted: string | undefined): string | null {
  const value = submitted?.trim() ?? "";
  if (value && value !== PENDING_EQUIVALENCY) return value;
  if (stored !== PENDING_EQUIVALENCY && stored.trim()) return stored;
  return null;
}

export function applyDiplomaEquivalency(
  result: Extract<EvaluationResult, { kind: "diploma" }>,
  equivalencies: string[],
  extras?: { countries?: string[]; fields?: string[]; dates?: string[] },
): Extract<EvaluationResult, { kind: "diploma" }> | null {
  if (equivalencies.length !== result.credentials.length) return null;
  const credentials = [];
  for (let index = 0; index < result.credentials.length; index += 1) {
    const credential = result.credentials[index];
    if (!credential) return null;
    const usEquivalency = staffValue(credential.usEquivalency, equivalencies[index]);
    const country = staffValue(credential.country, extras?.countries?.[index]);
    const field = staffValue(credential.field, extras?.fields?.[index]);
    const dates = staffValue(credential.dates, extras?.dates?.[index]);
    if (!usEquivalency || !country || !field || !dates) return null;
    credentials.push({ ...credential, usEquivalency, country, field, dates });
  }
  return { ...result, credentials };
}

export async function publishDiplomaEquivalency(
  db: Db,
  order: OrderRecord,
  equivalencies: string[],
  extras?: { countries?: string[]; fields?: string[]; dates?: string[] },
): Promise<void> {
  const current = order.evaluationResult;
  if (!awaitingEquivalencyPublish(order.reviewReason) || !current || current.kind !== "diploma") {
    throw new HttpError("This order is not waiting for an equivalency", 409);
  }
  const next = applyDiplomaEquivalency(current, equivalencies, extras);
  if (!next) throw new HttpError("Each credential needs a U.S. equivalency", 400);

  const version = await nextPreviewVersion(db, order.id);
  const { reportPath } = evaluationPreviewObjects(order.id, version);
  const inserted = await insertPreview(db, { orderId: order.id, version, previewPath: reportPath });
  if (inserted === "exists") return;

  const files = await renderEvaluationPdfs(next, {
    reportId: evaluationReportId(order.id),
    issued: evaluationIssuedLabel(order.createdAt),
    degreeCount: order.degreeCount,
    detectedPages: order.billablePages,
  });
  const cleanPath = `${order.id}/evaluation-v${version}.pdf`;
  const clean = await stampFinishedPdf(db, files.clean, { orderId: order.id, documentType: "evaluation" });
  await uploadObject(db, FINALS_BUCKET, cleanPath, clean, "application/pdf");
  await uploadObject(db, PREVIEWS_BUCKET, reportPath, files.preview, "application/pdf");
  await updateOrder(db, order.id, {
    review_reason: null,
    evaluation_result: { ...next, pageCount: files.pageCount },
    final_translation_path: cleanPath,
    certification_path: cleanPath,
  });
  await markPreview(db, order.id, version, "ready");
}

export async function publishCourseEquivalency(db: Db, order: OrderRecord, equivalency: string): Promise<void> {
  const current = order.evaluationResult;
  if (!awaitingEquivalencyPublish(order.reviewReason) || !current || current.kind !== "course_by_course") {
    throw new HttpError("This order is not waiting for an equivalency", 409);
  }
  const nextValue = equivalency.trim();
  if (!nextValue || nextValue === PENDING_EQUIVALENCY) {
    throw new HttpError("Each credential needs a U.S. equivalency", 400);
  }
  const next = { ...current, usEquivalency: nextValue };
  const version = await nextPreviewVersion(db, order.id);
  const { reportPath } = evaluationPreviewObjects(order.id, version);
  const inserted = await insertPreview(db, { orderId: order.id, version, previewPath: reportPath });
  if (inserted === "exists") return;

  const files = await renderEvaluationPdfs(next, {
    reportId: evaluationReportId(order.id),
    issued: evaluationIssuedLabel(order.createdAt),
    degreeCount: order.degreeCount,
    detectedPages: order.billablePages,
  });
  const cleanPath = `${order.id}/evaluation-v${version}.pdf`;
  const clean = await stampFinishedPdf(db, files.clean, { orderId: order.id, documentType: "evaluation" });
  await uploadObject(db, FINALS_BUCKET, cleanPath, clean, "application/pdf");
  await uploadObject(db, PREVIEWS_BUCKET, reportPath, files.preview, "application/pdf");
  await updateOrder(db, order.id, {
    review_reason: null,
    evaluation_result: { ...next, pageCount: files.pageCount },
    final_translation_path: cleanPath,
    certification_path: cleanPath,
  });
  await markPreview(db, order.id, version, "ready");
}

export function assembleCourse(
  extracted: CourseExtract,
  options?: {
    edgeRows?: Array<{ indigenousGrade: string; usEquivalent: string }>;
    usEquivalency?: string;
    equivalencyBasis?: string | null;
  },
): EvaluationResult | null {
  const applicant = filled(stripApplicantRegistration(extracted.applicant));
  const institution = filled(extracted.institution);
  // A regional board (CXC, WAEC) often prints no country; staff fill it like a diploma's.
  const country = orPending(normalizeEvaluationCountry(extracted.country));
  const credential = filled(extracted.credential);
  if (!applicant || !institution || !credential) return null;
  // Empty year groups are dropped; an unlabeled group keeps its courses under a neutral label.
  const yearGroups = extracted.years.filter((year) => year.courses.length > 0);
  if (yearGroups.length === 0) return null;

  const flat: RawCourse[] = [];
  for (const year of yearGroups) {
    for (const course of year.courses) {
      const originalName = filled(course.originalName) ?? filled(course.englishName);
      const englishName = originalName
        ? englishNameForCourse(originalName, filled(course.englishName) ?? originalName)
        : null;
      if (!originalName || !englishName) return null;
      // A blank grade counts as unreadable; scoreCourses tolerates a few of those.
      flat.push({ originalName, englishName, localCredits: course.localCredits, localGrade: course.localGrade.trim() || "—" });
    }
  }

  const scored = scoreCourses(flat, extracted.scale, options?.edgeRows, {
    credentialPassed: credentialWasPassed(extracted.result),
  });
  if (!scored) return null;

  let index = 0;
  const years = [];
  for (const year of yearGroups) {
    const courses = scored.courses.slice(index, index + year.courses.length);
    index += year.courses.length;
    years.push({ year: year.year.trim() || UNLABELED_YEAR, courses });
  }

  return {
    kind: "course_by_course",
    applicant,
    institution,
    country,
    credential,
    years,
    totalHours: scored.totalHours,
    gpa: scored.gpa,
    gradeScale: scored.usedEdge ? EDGE_GRADE_SCALE_TEXT : gradeScaleText(extracted.scale),
    ...(options?.usEquivalency ? { usEquivalency: options.usEquivalency } : {}),
    ...(options?.equivalencyBasis ? { equivalencyBasis: options.equivalencyBasis } : {}),
  };
}

/** Shown for a group of courses printed without a year or term. */
export const UNLABELED_YEAR = "Year not printed";

const DIPLOMA_EXTRACT_INSTRUCTIONS = `Extract each degree from this credential document.
Return one credential per degree that is printed. Copy the applicant, the institution, and the credential title as printed.
credential is the degree title as printed in the source language (for example Licence, Licenciatura, Licenciada, Licenciado, Maîtrise, Bachillerato, Baccalauréat). Do not translate credential.
englishCredential is the usual English name of that credential (for example Higher Secondary Certificate, Bachelor of Medicine, Technical Secondary School Baccalaureate). Leave it empty when credential is already in English.
field is the subject in English Title Case. "TECHNIQUES QUANTITATIVES DE GESTION" is "Quantitative Management Techniques". "Licenciada en Administración de Empresas" has field "Business Administration". Do not leave a field in another language or in all caps.
country is the country of the institution that awarded the credential, written in English (Cameroon, not Cameroun; Dominican Republic, not República Dominicana). If the country is not printed, infer it from the city or state (Guadalajara, Jalisco is Mexico). For a regional examination board such as CXC (Caribbean Examinations Council) or WAEC (West African Examinations Council), country is the candidate's own country, taken from the school, centre, or address. Use an empty string only when no place is printed.
dates is the examination or conferral date in English. "26 Mars 2003" is "March 26, 2003". "22 Août 2001" is "August 22, 2001". Keep a printed year range as a range, such as 2016–2019.
Return the student's granted title even when a field is missing. Do not add degrees for the rector or other signatories. Do not invent a degree.`;

const COURSE_EXTRACT_INSTRUCTIONS = `Extract this academic transcript into a course-by-course table.
Group courses by the academic year printed on the page. Keep each year label as printed.
When the page is one examination session and has no academic year, use the session year as the year label.
credential is the credential title as printed in the source language. Do not translate credential. englishCredential is its usual English name, empty when it is already in English.
country is the country of the institution that awarded the credential, written in English (Cameroon, not Cameroun; Dominican Republic, not República Dominicana). If the country is not printed, infer it from the city or state (Guadalajara, Jalisco is Mexico). For a regional examination board such as CXC (Caribbean Examinations Council) or WAEC (West African Examinations Council), country is the candidate's own country, taken from the school, centre, or address. Use an empty string only when no place is printed.
originalName is the course title as printed in the source language. englishName is the accurate English translation in Title Case. "Sciences Economiques et Juridiques" is "Economic and Legal Sciences". "Mathématiques Appliquées" is "Applied Mathematics". When the printed title is already English, englishName is that title and not a copy of a non-English name.
localCredits and localGrade are the values as printed. localGrade is a string.
When the columns are Subject, Coefficient, and Note × Coefficient, localCredits is the coefficient and localGrade is the mark out of 20: (Note × Coefficient) / Coefficient. Do not copy the weighted product as the grade.
Do not include total, average, decision, or bonus rows as courses.
scale is "10" when grades are out of 10 (Brazil, Spain), "20" when out of 20 (France, Cameroon), "100" for marks or percentages out of 100 (India, Pakistan, Ghana marks), "4" for grade points on a 4.0 scale, "roman" for CXC/CSEC grades I to VI, and "letter" when grades are already A–F.
localGrade is the grade as printed: a number, a letter, a Roman numeral, or a word such as Pass. localCredits is 0 when no credits or hours are printed.
result is the overall decision printed on the credential, such as Admis, Passed, Réussi, Ajourné, Refusé, or Failed. Use an empty string when no overall result is printed.
Do not convert grades. Do not invent courses.`;

export async function extractDiploma(text: string): Promise<DiplomaExtract> {
  return generateObject(diplomaSchema, [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${DIPLOMA_EXTRACT_INSTRUCTIONS}

Document text:
${text.slice(0, 12000)}`,
        },
      ],
    },
  ]);
}

async function extractDiplomaFile(file: { bytes: Uint8Array; mime: string }): Promise<DiplomaExtract> {
  return generateObject(diplomaSchema, [
    {
      role: "user",
      content: [
        { type: "text", text: `${DIPLOMA_EXTRACT_INSTRUCTIONS}\n\nThe credential file is attached.` },
        { type: "file", mediaType: file.mime, data: file.bytes },
      ],
    },
  ]);
}

async function extractCourseChunk(text: string, part: string): Promise<CourseExtract> {
  return generateObject(courseSchema, [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${COURSE_EXTRACT_INSTRUCTIONS}

Document text:
${part}${text}`,
        },
      ],
    },
  ], undefined, { lowReasoning: true });
}

/** Characters per course-extraction call. Longer transcripts are split on line breaks. */
export const COURSE_CHUNK_CHARS = 9000;

export function splitTranscript(text: string, size = COURSE_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const piece = line.slice(0, size);
    if (current && current.length + piece.length + 1 > size) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current.trim()) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

/** Header fields from the first chunk that has them; years merged by label in reading order. */
export function mergeCourseExtracts(parts: readonly CourseExtract[]): CourseExtract {
  const first = (pick: (part: CourseExtract) => string | undefined) =>
    parts.map(pick).find((value) => value != null && value.trim() !== "") ?? "";
  const years: CourseExtract["years"] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const year of part.years) {
      const label = year.year.trim();
      const fresh = year.courses.filter((course) => {
        const key = `${label}|${course.originalName.trim().toLowerCase()}|${course.localGrade.trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const existing = years.find((item) => item.year.trim() === label);
      if (existing) existing.courses.push(...fresh);
      else if (fresh.length > 0) years.push({ year: year.year, courses: [...fresh] });
    }
  }
  const counts = new Map<CourseExtract["scale"], number>();
  for (const part of parts) {
    const weight = part.years.reduce((sum, year) => sum + year.courses.length, 0);
    counts.set(part.scale, (counts.get(part.scale) ?? 0) + weight);
  }
  const scale = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "letter";
  return {
    applicant: first((part) => part.applicant),
    institution: first((part) => part.institution),
    country: first((part) => part.country),
    credential: first((part) => part.credential),
    englishCredential: first((part) => part.englishCredential),
    scale,
    result: first((part) => part.result),
    years,
  };
}

export async function extractCourses(text: string): Promise<CourseExtract> {
  const chunks = splitTranscript(text);
  const parts: CourseExtract[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const part =
      chunks.length > 1 ? `(Part ${index + 1} of ${chunks.length} of one transcript. Extract only the courses in this part.)\n` : "";
    parts.push(await extractCourseChunk(chunk, part));
  }
  return parts.length === 1 ? parts[0]! : mergeCourseExtracts(parts);
}

async function extractCoursesFile(file: { bytes: Uint8Array; mime: string }): Promise<CourseExtract> {
  return generateObject(courseSchema, [
    {
      role: "user",
      content: [
        { type: "text", text: `${COURSE_EXTRACT_INSTRUCTIONS}\n\nThe transcript file is attached.` },
        { type: "file", mediaType: file.mime, data: file.bytes },
      ],
    },
  ]);
}

export type PrintedCredential = {
  kind: "diploma" | "transcript";
  country: string;
  credential: string;
};

/**
 * Country and credential title for an equivalency match.
 * Uses the same diploma and transcript readers as an official evaluation.
 * A dense text layer is read as text. A scan or photo is read from the file.
 */
export async function extractPrintedCredentials(input: {
  text: string;
  file?: { bytes: Uint8Array; mime: string };
}): Promise<PrintedCredential[]> {
  const text = input.text.trim();
  const useText = countWords(text) >= SPARSE_PAGE_WORDS || !input.file;
  const file = input.file;
  const diploma = useText || !file ? await extractDiploma(text) : await extractDiplomaFile(file);
  const degrees = diploma.credentials.flatMap((item) => {
    const country = item.country.trim();
    const credential = item.credential.trim();
    if (!country || !credential) return [];
    return [{ kind: "diploma" as const, country, credential }];
  });
  if (degrees.length > 0) return degrees.slice(0, 5);
  const courses = useText || !file ? await extractCourses(text) : await extractCoursesFile(file);
  const country = courses.country.trim();
  const credential = courses.credential.trim();
  if (!country || !credential) return [];
  return [{ kind: "transcript", country, credential }];
}

type EvaluationContext = {
  sourceLanguage: string | null;
  confidence: number | null;
  billablePages: number;
  imageQuality: boolean;
  detectionAvailable: boolean;
  languagesDisagree: boolean;
  pageText: string;
  filenames: string[];
  combinedPath: string | null;
  pageOrderBasis: OrderRecord["pageOrderBasis"];
  pageOrder: StoredPageOrder | null;
  token: string | null;
};

/**
 * Best-effort watermarked translation next to the report. A failure here does
 * not mark the evaluation report failed or move the order to needs_review.
 * English sources are not translated. Staff republish of a diploma does not
 * call this; the existing translation-preview object stays.
 */
async function storeTranslationPreview(
  db: Db,
  order: OrderRecord,
  reportVersion: number,
  sourceLanguage: string | null,
): Promise<void> {
  if (!needsBundledTranslation(sourceLanguage) || !sourceLanguage) return;
  let rowVersion: number | null = null;
  let insertedTranslation = false;
  try {
    rowVersion = await nextPreviewVersion(db, order.id);
    const record = translationPreviewRecord({
      orderId: order.id,
      reportVersion,
      rowVersion,
    });
    const inserted = await insertPreview(db, {
      orderId: order.id,
      version: record.version,
      previewPath: record.previewPath,
    });
    if (inserted === "exists") return;
    insertedTranslation = true;
    const bytes = translationPreviewBytes({
      watermarkedPreview: await watermarkedTranslationPreview(db, {
        orderId: order.id,
        sourceLanguage,
        targetLanguage: order.targetLanguage,
        customerId: order.customerId,
      }),
    });
    await uploadObject(db, PREVIEWS_BUCKET, record.previewPath, bytes, "application/pdf");
    await markPreview(db, order.id, record.version, "ready");
  } catch (error) {
    if (insertedTranslation && rowVersion != null) {
      try {
        await markPreview(db, order.id, rowVersion, "failed");
      } catch (markError) {
        console.error("evaluation translation preview status failed", markError);
      }
    }
    console.error("evaluation translation preview failed", error);
  }
}

function languageConfirmed(input: EvaluationContext, language: string | null): boolean {
  return Boolean(
    language &&
      input.detectionAvailable &&
      !input.languagesDisagree &&
      input.confidence != null &&
      input.confidence >= LOW_LANGUAGE_CONFIDENCE,
  );
}

type EdgeHit = {
  credential: EdgeCredentialMatch | null;
  scale: EdgeGradingScaleRecord | null;
};

async function edgeCatalog(
  db: Db,
  country: string,
): Promise<{ credentials: EdgeCredentialRecord[]; scales: EdgeGradingScaleRecord[] }> {
  const slug = countrySlug(country);
  if (!slug || country === PENDING_EQUIVALENCY) return { credentials: [], scales: [] };
  try {
    const resolved = await resolveEdgeCountrySlug(db, slug);
    if (!resolved) return { credentials: [], scales: [] };
    const [credentials, scales] = await Promise.all([
      listEdgeCredentialsForCountry(db, resolved),
      listEdgeGradingScalesForCountry(db, resolved),
    ]);
    return { credentials, scales };
  } catch (error) {
    console.error("edge reference lookup failed", error);
    return { credentials: [], scales: [] };
  }
}


async function suggestionForCredential(db: Db, edgeCredentialId: string | null): Promise<EdgeEquivalencyRecord | null> {
  if (!edgeCredentialId) return null;
  try {
    return pickEdgeEquivalency(await listEdgeEquivalenciesForCredential(db, edgeCredentialId));
  } catch (error) {
    console.error("edge equivalency lookup failed", error);
    return null;
  }
}

async function draftForCredential(
  db: Db,
  printed: string,
  hit: EdgeHit,
  storedCredentialId: string | null,
  singleCredential: boolean,
): Promise<{ draft: EquivalencyDraft; edgeCredentialId: string | null }> {
  const edgeCredentialId = equivalencyCredentialId({
    matchedId: hit.credential?.id ?? null,
    storedId: storedCredentialId,
    singleCredential,
  });
  const suggestion = await suggestionForCredential(db, edgeCredentialId);
  return { draft: draftEquivalency({ printed, suggestion }), edgeCredentialId };
}

export async function buildEvaluatedResult(
  db: Db,
  service: "diploma" | "course_by_course",
  extracted: DiplomaExtract | CourseExtract,
  degreeCount: number,
  documentsReviewed: string[],
  storedCredentialId: string | null,
): Promise<{
  result: EvaluationResult | null;
  edgeCredentialId: string | null;
  edgeGradingScaleId: string | null;
  edgeMatchMethod: CredentialMatchMethod | null;
  route: EquivalencyRoute;
}> {
  if (service === "diploma") {
    const diploma = extracted as DiplomaExtract;
    const catalogs = new Map<string, { credentials: EdgeCredentialRecord[]; scales: EdgeGradingScaleRecord[] }>();
    const hits: EdgeHit[] = [];
    for (const item of diploma.credentials) {
      const slug = countrySlug(item.country);
      if (!catalogs.has(slug)) catalogs.set(slug, await edgeCatalog(db, item.country));
      const catalog = catalogs.get(slug) ?? { credentials: [], scales: [] };
      hits.push({
        credential: matchEitherTitle(catalog.credentials, item),
        scale: matchEdgeGradingScale(catalog.scales, { country: item.country, title: item.credential, grades: [] }),
      });
    }
    const drafts: EquivalencyDraft[] = [];
    const credentialIds: Array<string | null> = [];
    const singleCredential = diploma.credentials.length === 1;
    for (let index = 0; index < diploma.credentials.length; index += 1) {
      const printed = diploma.credentials[index]?.credential ?? "";
      const drafted = await draftForCredential(
        db,
        printed,
        hits[index] ?? { credential: null, scale: null },
        storedCredentialId,
        singleCredential,
      );
      drafts.push(drafted.draft);
      credentialIds.push(drafted.edgeCredentialId);
    }
    const scale = hits.find((hit) => hit.scale)?.scale ?? null;
    const chosen = chosenEdgeMatch(hits, credentialIds);
    return {
      result: assembleDiploma({
        extracted: diploma,
        degreeCount,
        documentsReviewed,
        equivalencies: drafts.map((draft) => draft.usEquivalency),
        bases: drafts.map((draft) => draft.basis),
      }),
      edgeCredentialId: chosen.edgeCredentialId,
      edgeGradingScaleId: scale?.id ?? null,
      edgeMatchMethod: chosen.edgeMatchMethod,
      route: combineEquivalencyRoutes(drafts.map((draft) => draft.route)),
    };
  }

  const courses = extracted as CourseExtract;
  const catalog = await edgeCatalog(db, courses.country);
  const grades = courses.years.flatMap((year) => year.courses.map((course) => course.localGrade));
  const hit: EdgeHit = {
    credential: matchEitherTitle(catalog.credentials, courses),
    scale: matchEdgeGradingScale(catalog.scales, { country: courses.country, title: courses.credential, grades }),
  };
  const drafted = await draftForCredential(db, courses.credential, hit, storedCredentialId, true);
  return {
    result: assembleCourse(courses, {
      edgeRows: hit.scale?.rows,
      usEquivalency: drafted.draft.usEquivalency,
      equivalencyBasis: drafted.draft.basis,
    }),
    edgeCredentialId: drafted.edgeCredentialId,
    edgeGradingScaleId: hit.scale?.id ?? null,
    edgeMatchMethod:
      hit.credential && drafted.edgeCredentialId === hit.credential.id ? hit.credential.matchMethod : null,
    route: drafted.draft.route,
  };
}

/** The printed title first, then the English name the extractor gave for it. */
export function matchEitherTitle(
  rows: readonly EdgeCredentialRecord[],
  item: { country: string; credential: string; englishCredential?: string },
): EdgeCredentialMatch | null {
  const printed = matchEdgeCredential(rows, { country: item.country, title: item.credential });
  if (printed) return printed;
  const english = item.englishCredential?.trim();
  if (!english || english === item.credential.trim()) return null;
  return matchEdgeCredential(rows, { country: item.country, title: english });
}

function chosenEdgeMatch(
  hits: readonly EdgeHit[],
  credentialIds: readonly (string | null)[],
): { edgeCredentialId: string | null; edgeMatchMethod: CredentialMatchMethod | null } {
  for (let index = 0; index < credentialIds.length; index += 1) {
    const edgeCredentialId = credentialIds[index];
    if (!edgeCredentialId) continue;
    const matched = hits[index]?.credential;
    return {
      edgeCredentialId,
      edgeMatchMethod: matched && matched.id === edgeCredentialId ? matched.matchMethod : null,
    };
  }
  return { edgeCredentialId: null, edgeMatchMethod: null };
}

function storedEdgeMatch(built: {
  edgeCredentialId: string | null;
  edgeGradingScaleId: string | null;
  edgeMatchMethod: CredentialMatchMethod | null;
}): Record<string, string | null> {
  const patch: Record<string, string | null> = {
    edge_credential_id: built.edgeCredentialId,
    edge_grading_scale_id: built.edgeGradingScaleId,
  };
  if (built.edgeMatchMethod) patch.edge_match_method = built.edgeMatchMethod;
  else if (!built.edgeCredentialId) patch.edge_match_method = null;
  return patch;
}

/**
 * One purchased evaluation from page text already stored on the order.
 * Course-by-course does not need a stored degree count. A diploma uses the
 * paid credential count, or one credential when that count was not saved.
 */
export type ServiceFromText = {
  result: EvaluationResult | null;
  failures: TranscriptRowFailure[];
  edgeCredentialId: string | null;
  edgeGradingScaleId: string | null;
  edgeMatchMethod: CredentialMatchMethod | null;
  route: EquivalencyRoute;
};

const EMPTY_SERVICE: ServiceFromText = {
  result: null,
  failures: [],
  edgeCredentialId: null,
  edgeGradingScaleId: null,
  edgeMatchMethod: null,
  route: "qa_research",
};

function serviceFromBuilt(
  built: Awaited<ReturnType<typeof buildEvaluatedResult>>,
  failures: TranscriptRowFailure[],
): ServiceFromText {
  return {
    result: built.result,
    failures,
    edgeCredentialId: built.edgeCredentialId,
    edgeGradingScaleId: built.edgeGradingScaleId,
    edgeMatchMethod: built.edgeMatchMethod,
    route: built.route,
  };
}

export async function evaluateServiceFromText(
  db: Db,
  order: OrderRecord,
  service: EvaluationService,
  pageText: string,
  filenames: string[],
): Promise<ServiceFromText> {
  const degreeCount = paidEvaluationDegreeCount(order) ?? (service === "course_by_course" ? 1 : null);
  if (degreeCount == null) return EMPTY_SERVICE;
  if (service === "course_by_course") {
    const parsed = courseExtractFromTranscript(pageText);
    if (parsed.extract) {
      const named = await withEnglishCourseNames(parsed.extract);
      const fromTranscript = await buildEvaluatedResult(
        db,
        service,
        named,
        degreeCount,
        filenames,
        order.edgeCredentialId,
      );
      if (fromTranscript.result) return serviceFromBuilt(fromTranscript, parsed.failures);
    }
    const recovered = recoverCourseExtract(await extractCourses(pageText));
    const named = await withEnglishCourseNames(recovered.extract);
    const built = await buildEvaluatedResult(
      db,
      service,
      named,
      degreeCount,
      filenames,
      order.edgeCredentialId,
    );
    return serviceFromBuilt(built, [...parsed.failures, ...recovered.failures]);
  }
  const built = await buildEvaluatedResult(
    db,
    service,
    normalizeDiplomaExtract(await extractDiploma(pageText)),
    degreeCount,
    filenames,
    order.edgeCredentialId,
  );
  return serviceFromBuilt(built, []);
}

/** What analysis stores after it builds an evaluation the way it builds a translation preview. */
export type EvaluationPreparation = {
  status: "preview_ready" | "needs_review" | "skipped";
  totalCents: number | null;
  billablePages: number;
};

function preparation(
  status: EvaluationPreparation["status"],
  billablePages: number,
  totalCents: number | null = null,
): EvaluationPreparation {
  return { status, totalCents, billablePages };
}

function orderIncludesTranslation(order: Parameters<typeof resolveServices>[0]): boolean {
  return resolveServices(order).includes("translation");
}

async function pageTextForService(
  db: Db,
  order: OrderRecord,
  service: EvaluationService,
  fallback: string,
): Promise<string> {
  try {
    const documents = await listDocuments(db, order.id);
    if (documents.length === 0) return fallback;
    const pages = await listPages(
      db,
      documents.map((document) => document.id),
    );
    const text = textForPaidEvaluation(documents, pages, service);
    return text.trim() ? text : fallback;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "evaluation page text failed");
    return fallback;
  }
}

async function storeCleanEvaluation(
  db: Db,
  order: OrderRecord,
  service: EvaluationService,
  clean: Uint8Array,
): Promise<string> {
  const path = evaluationServicePath(order.id, service);
  const stamped = await stampFinishedPdf(db, clean, { orderId: order.id, documentType: "evaluation" });
  await uploadObject(db, FINALS_BUCKET, path, stamped, "application/pdf");
  return path;
}

function equivalencyFieldsPending(result: EvaluationResult): boolean {
  if (result.kind === "diploma") return diplomaEquivalencyPending(result.credentials);
  return result.usEquivalency === PENDING_EQUIVALENCY;
}

/**
 * A confident qa_review report with no pending equivalency fields is ready to release.
 * Research, or any field still marked pending, stays on the research hold.
 */
function reviewReasonForPreparedEvaluation(
  route: EquivalencyRoute,
  results: readonly EvaluationResult[],
): string | null {
  const pending = results.some(equivalencyFieldsPending);
  if (route === "qa_review" && !pending) return null;
  return EQUIVALENCY_QA_RESEARCH;
}

export async function completeEvaluation(
  db: Db,
  order: OrderRecord,
  input: EvaluationContext,
): Promise<EvaluationPreparation> {
  const kinds = orderEvaluationKinds(order);
  if (kinds.length > 1) {
    return completeSelectedEvaluations(db, order, input, kinds);
  }
  const service = order.service ?? kinds[0] ?? null;
  if (!service || order.degreeCount == null) return preparation("skipped", input.billablePages);
  const degreeCount = order.degreeCount;
  const language = input.languagesDisagree ? null : input.sourceLanguage;

  const quoteFor = (source: string | null) =>
    source
      ? selectionPricePatch({
          services: order.services,
          service,
          includeTranslation: order.includeTranslation,
          orderType: order.orderType,
          serviceType: order.serviceType,
          degreeCount,
          sourceLanguage: source,
          billablePages: input.billablePages,
          addonCents: order.addonCents,
        })
      : null;

  const hold = async (reason: string, pricedLanguage: string | null): Promise<EvaluationPreparation> => {
    const quote = quoteFor(pricedLanguage);
    await updateOrder(db, order.id, {
      status: "needs_review",
      review_reason: reason,
      eta_at: null,
      source_language: pricedLanguage,
      billable_pages: input.billablePages,
      combined_original_path: input.combinedPath,
      page_order_basis: input.pageOrderBasis,
      page_order: input.pageOrder,
      ...(quote ?? {
        evaluation_cents: null,
        translation_cents: null,
        total_cents: null,
      }),
    });
    return preparation("needs_review", input.billablePages, quote?.total_cents ?? null);
  };

  if (input.imageQuality) return hold(IMAGE_QUALITY_REASON, language);
  if (!languageConfirmed(input, language)) return hold(LANGUAGE_REASON, language);

  const version = await nextPreviewVersion(db, order.id);
  const { reportPath } = evaluationPreviewObjects(order.id, version);
  const inserted = await insertPreview(db, { orderId: order.id, version, previewPath: reportPath });
  if (inserted === "exists") return preparation("preview_ready", input.billablePages, order.totalCents);

  try {
    const text = await pageTextForService(db, order, service, input.pageText);
    const built = await evaluateServiceFromText(db, order, service, text, input.filenames);
    const result = built.result;
    if (!result) {
      await markPreview(db, order.id, version, "failed");
      const held = await hold(UNMAPPED_REASON, language);
      await updateOrder(db, order.id, storedEdgeMatch(built));
      return held;
    }

    const files = await renderEvaluationPdfs(result, {
      reportId: evaluationReportId(order.id),
      issued: evaluationIssuedLabel(order.createdAt),
      degreeCount: order.degreeCount,
      detectedPages: input.billablePages,
    });
    const cleanPath = await storeCleanEvaluation(db, order, service, files.clean);
    const stored: EvaluationResult = { ...result, pageCount: files.pageCount };
    await uploadObject(db, PREVIEWS_BUCKET, reportPath, files.preview, "application/pdf");
    const quote = quoteFor(language);
    const serviceFiles = { ...(order.serviceFiles ?? {}), [service]: cleanPath };
    await updateOrder(db, order.id, {
      status: "preview_ready",
      review_reason: reviewReasonForPreparedEvaluation(built.route, [stored]),
      eta_at: null,
      source_language: language,
      language_confirmed: true,
      billable_pages: input.billablePages,
      combined_original_path: input.combinedPath,
      page_order_basis: input.pageOrderBasis,
      page_order: input.pageOrder,
      ...(quote ?? {
        evaluation_cents: null,
        translation_cents: null,
        total_cents: null,
      }),
      evaluation_result: stored,
      evaluation_results: [stored],
      service_files: serviceFiles,
      ...(!orderIncludesTranslation(order)
        ? { final_translation_path: cleanPath, certification_path: cleanPath }
        : {}),
      ...storedEdgeMatch(built),
    });
    await markPreview(db, order.id, version, "ready");
    if (order.includeTranslation) await storeTranslationPreview(db, order, version, language);
    await insertEvent(db, order.id, "preview_ready", { version, pageCount: files.pageCount });
    const { notifyLifecycle } = await import("./webhook-delivery");
    await notifyLifecycle(db, order.id, "order.preview_ready");
    const email = await orderCustomerEmail(db, order.id);
    if (email) {
      await sendPreviewReady(email, {
        token: input.token,
        orderId: order.id,
        sourceLanguage: language,
        targetLanguage: order.targetLanguage,
        documentCount: input.filenames.length,
        pageCount: input.billablePages,
        totalCents: quote?.total_cents ?? null,
        includesTranslation: (quote?.translation_cents ?? 0) > 0,
      });
    }
    return preparation("preview_ready", input.billablePages, quote?.total_cents ?? null);
  } catch (error) {
    await markPreview(db, order.id, version, "failed");
    if (error instanceof AiUnavailableError) return hold(READ_REASON, language);
    const message = error instanceof Error ? error.message : READ_REASON;
    return hold(message, language);
  }
}

/**
 * Diploma and course-by-course on the same order. Each report is built, then
 * the previews are stored as one PDF. The price is the sum of both fees.
 */
async function completeSelectedEvaluations(
  db: Db,
  order: OrderRecord,
  input: EvaluationContext,
  kinds: Array<"diploma" | "course_by_course">,
): Promise<EvaluationPreparation> {
  if (order.degreeCount == null) return preparation("skipped", input.billablePages);
  const degreeCount = order.degreeCount;
  const language = input.languagesDisagree ? null : input.sourceLanguage;
  const quoteFor = (source: string | null) =>
    source
      ? selectionPricePatch({
          services: order.services,
          service: order.service,
          includeTranslation: order.includeTranslation,
          orderType: order.orderType,
          serviceType: order.serviceType,
          degreeCount,
          sourceLanguage: source,
          billablePages: input.billablePages,
          addonCents: order.addonCents,
        })
      : null;
  const hold = async (reason: string, pricedLanguage: string | null): Promise<EvaluationPreparation> => {
    const quote = quoteFor(pricedLanguage);
    await updateOrder(db, order.id, {
      status: "needs_review",
      review_reason: reason,
      eta_at: null,
      source_language: pricedLanguage,
      billable_pages: input.billablePages,
      combined_original_path: input.combinedPath,
      page_order_basis: input.pageOrderBasis,
      page_order: input.pageOrder,
      ...(quote ?? { evaluation_cents: null, translation_cents: null, total_cents: null }),
    });
    return preparation("needs_review", input.billablePages, quote?.total_cents ?? null);
  };
  if (input.imageQuality) return hold(IMAGE_QUALITY_REASON, language);
  if (!languageConfirmed(input, language)) return hold(LANGUAGE_REASON, language);

  const version = await nextPreviewVersion(db, order.id);
  const { reportPath } = evaluationPreviewObjects(order.id, version);
  const inserted = await insertPreview(db, { orderId: order.id, version, previewPath: reportPath });
  if (inserted === "exists") return preparation("preview_ready", input.billablePages, order.totalCents);

  try {
    const previews: Uint8Array[] = [];
    const results: EvaluationResult[] = [];
    const routes: EquivalencyRoute[] = [];
    const serviceFiles: Partial<Record<EvaluationService, string>> = { ...(order.serviceFiles ?? {}) };
    let edge: ReturnType<typeof storedEdgeMatch> = storedEdgeMatch({
      edgeCredentialId: null,
      edgeGradingScaleId: null,
      edgeMatchMethod: null,
    });
    for (const service of kinds) {
      const text = await pageTextForService(db, order, service, input.pageText);
      const built = await evaluateServiceFromText(db, order, service, text, input.filenames);
      edge = storedEdgeMatch(built);
      routes.push(built.route);
      if (!built.result) {
        await markPreview(db, order.id, version, "failed");
        const held = await hold(UNMAPPED_REASON, language);
        await updateOrder(db, order.id, edge);
        return held;
      }
      const files = await renderEvaluationPdfs(built.result, {
        reportId: evaluationReportId(order.id),
        issued: evaluationIssuedLabel(order.createdAt),
        degreeCount,
        detectedPages: input.billablePages,
      });
      serviceFiles[service] = await storeCleanEvaluation(db, order, service, files.clean);
      previews.push(files.preview);
      results.push({ ...built.result, pageCount: files.pageCount });
    }
    const preview = previews.length === 1 ? previews[0]! : await concatPdfs(previews);
    const primary = results.find((result) => result.kind === "diploma") ?? results[0] ?? null;
    const route = combineEquivalencyRoutes(routes);
    await uploadObject(db, PREVIEWS_BUCKET, reportPath, preview, "application/pdf");
    const quote = quoteFor(language);
    await updateOrder(db, order.id, {
      status: "preview_ready",
      review_reason: reviewReasonForPreparedEvaluation(route, results),
      eta_at: null,
      source_language: language,
      language_confirmed: true,
      billable_pages: input.billablePages,
      combined_original_path: input.combinedPath,
      page_order_basis: input.pageOrderBasis,
      page_order: input.pageOrder,
      ...(quote ?? { evaluation_cents: null, translation_cents: null, total_cents: null }),
      ...(primary ? { evaluation_result: primary } : {}),
      evaluation_results: results,
      service_files: serviceFiles,
      ...edge,
    });
    await markPreview(db, order.id, version, "ready");
    if (order.includeTranslation) await storeTranslationPreview(db, order, version, language);
    await insertEvent(db, order.id, "preview_ready", { version, services: kinds });
    const { notifyLifecycle } = await import("./webhook-delivery");
    await notifyLifecycle(db, order.id, "order.preview_ready");
    const email = await orderCustomerEmail(db, order.id);
    if (email) {
      await sendPreviewReady(email, {
        token: input.token,
        orderId: order.id,
        sourceLanguage: language,
        targetLanguage: order.targetLanguage,
        documentCount: input.filenames.length,
        pageCount: input.billablePages,
        totalCents: quote?.total_cents ?? null,
        includesTranslation: (quote?.translation_cents ?? 0) > 0,
      });
    }
    return preparation("preview_ready", input.billablePages, quote?.total_cents ?? null);
  } catch (error) {
    await markPreview(db, order.id, version, "failed");
    if (error instanceof AiUnavailableError) return hold(READ_REASON, language);
    const message = error instanceof Error ? error.message : READ_REASON;
    return hold(message, language);
  }
}

/**
 * Build the evaluation during analysis, the same way a translation preview is built on upload.
 * Draft, quoted, confirmed, and processing orders are prepared. A failed order is prepared
 * again once the language is confirmed. Orders with no evaluation are not.
 */
export function shouldPrepareEvaluationReport(order: {
  service: OrderRecord["service"];
  services?: OrderRecord["services"];
  includeTranslation?: boolean | null;
  orderType?: string | null;
  serviceType?: string | null;
  status: string;
  languageConfirmed: boolean;
}): boolean {
  if (!orderHasEvaluation(order)) return false;
  if (
    order.status === "draft" ||
    order.status === "quoted" ||
    order.status === "confirmed" ||
    order.status === "processing"
  ) {
    return true;
  }
  return order.status === "failed" && order.languageConfirmed;
}

/**
 * Price an evaluation without building the report.
 * Analysis uses this only when {@link shouldPrepareEvaluationReport} is false.
 * Translation cents stay 0 unless the customer already opted in.
 */
export async function startEvaluationQuote(
  db: Db,
  order: OrderRecord,
  input: EvaluationContext,
): Promise<{ status: "quoted" | "needs_review"; totalCents: number | null; billablePages: number }> {
  if (!orderHasEvaluation(order) || order.degreeCount == null) {
    return { status: "needs_review", totalCents: null, billablePages: input.billablePages };
  }
  const language = input.languagesDisagree ? null : input.sourceLanguage;
  const ready = !input.imageQuality && languageConfirmed(input, language);
  const priced = selectionPricePatch({
    services: order.services,
    service: order.service,
    includeTranslation: order.includeTranslation,
    orderType: order.orderType,
    serviceType: order.serviceType,
    degreeCount: order.degreeCount,
    sourceLanguage: language,
    billablePages: input.billablePages,
    addonCents: order.addonCents,
  });
  if (!priced) {
    return { status: "needs_review", totalCents: null, billablePages: input.billablePages };
  }
  const status = ready ? "quoted" : "needs_review";
  await updateOrder(db, order.id, {
    status,
    review_reason: input.imageQuality ? IMAGE_QUALITY_REASON : ready ? null : LANGUAGE_REASON,
    eta_at: status === "quoted" ? etaFromNow(1) : null,
    source_language: language,
    billable_pages: input.billablePages,
    combined_original_path: input.combinedPath,
    page_order_basis: input.pageOrderBasis,
    page_order: input.pageOrder,
    ...priced,
  });
  return { status, totalCents: priced.total_cents, billablePages: input.billablePages };
}

export async function retryEvaluation(db: Db, order: OrderRecord, sourceLanguage: string): Promise<void> {
  const documents = await listDocuments(db, order.id);
  const pages = await listPages(
    db,
    documents.map((document) => document.id),
  );
  const pageText = [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => page.ocrText ?? "")
    .filter(Boolean)
    .join("\n");
  await completeEvaluation(db, { ...order, sourceLanguage }, {
    sourceLanguage,
    confidence: 1,
    billablePages: order.billablePages ?? 0,
    imageQuality: false,
    detectionAvailable: true,
    languagesDisagree: false,
    pageText,
    filenames: documents.map((document) => document.filename),
    combinedPath: order.combinedOriginalPath,
    pageOrderBasis: order.pageOrderBasis,
    pageOrder: order.pageOrder,
    token: null,
  });
}
