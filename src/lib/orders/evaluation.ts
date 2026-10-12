import { z } from "zod";
import { generateObject } from "./ai";
import { LOW_LANGUAGE_CONFIDENCE, FINALS_BUCKET, PREVIEWS_BUCKET } from "./constants";
import {
  customerEmail,
  insertEvent,
  insertPreview,
  listDocuments,
  listEdgeCredentialsForCountry,
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
import { evaluationQuote, needsBundledTranslation } from "./evaluation-price";
import { EQUIVALENCY_UNMAPPED, PENDING_EQUIVALENCY, diplomaEquivalencyPending } from "./equivalency";
import {
  chooseEquivalency,
  countrySlug,
  edgeContentExcerpt,
  edgeEquivalencyPrompt,
  matchEdgeCredential,
  matchEdgeGradingScale,
  type EdgeCredentialRecord,
  type EdgeGradingScaleRecord,
} from "./edge";
import { EDGE_GRADE_SCALE_TEXT, gradeScaleText, scoreCourses, usEquivalency, type RawCourse } from "./grades";
import { IMAGE_QUALITY_REASON } from "./image-quality";
import { evaluationIssuedLabel, evaluationReportId, renderEvaluationPdfs } from "./pdf/evaluation";
import { uploadObject } from "./storage";
import { watermarkedTranslationPreview } from "./translation";
import type { EvaluationResult, OrderRecord, StoredPageOrder } from "./types";

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
      field: z.string(),
      dates: z.string(),
    }),
  ),
});

const equivalencySchema = z.object({
  usEquivalency: z.enum([
    "High school diploma",
    "Associate degree",
    "Bachelor's degree",
    "Master's degree",
    "Doctoral degree",
    "",
  ]),
  confident: z.boolean(),
});

const courseSchema = z.object({
  applicant: z.string(),
  institution: z.string(),
  country: z.string(),
  credential: z.string(),
  scale: z.enum(["10", "20", "letter"]),
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

export function assembleDiploma(input: {
  extracted: DiplomaExtract;
  degreeCount: number;
  documentsReviewed: string[];
  equivalencies?: Array<string | null | undefined>;
}): EvaluationResult | null {
  if (input.extracted.credentials.length !== input.degreeCount) return null;
  if (input.documentsReviewed.length === 0) return null;
  const credentials = [];
  for (const [index, item] of input.extracted.credentials.entries()) {
    const applicant = filled(item.applicant);
    const institution = filled(item.institution);
    const credential = filled(item.credential);
    if (!applicant || !institution || !credential) return null;
    credentials.push({
      applicant,
      institution,
      country: orPending(item.country),
      credential,
      field: orPending(item.field, subjectFromTitle(credential) ?? ""),
      dates: orPending(item.dates),
      usEquivalency: input.equivalencies?.[index] ?? usEquivalency(credential) ?? PENDING_EQUIVALENCY,
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
  if (order.reviewReason !== EQUIVALENCY_UNMAPPED || !current || current.kind !== "diploma") {
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
  });
  const cleanPath = `${order.id}/evaluation-v${version}.pdf`;
  await uploadObject(db, FINALS_BUCKET, cleanPath, files.clean, "application/pdf");
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
  if (order.reviewReason !== EQUIVALENCY_UNMAPPED || !current || current.kind !== "course_by_course") {
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
  });
  const cleanPath = `${order.id}/evaluation-v${version}.pdf`;
  await uploadObject(db, FINALS_BUCKET, cleanPath, files.clean, "application/pdf");
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
  options?: { edgeRows?: Array<{ indigenousGrade: string; usEquivalent: string }>; usEquivalency?: string },
): EvaluationResult | null {
  const applicant = filled(extracted.applicant);
  const institution = filled(extracted.institution);
  const country = filled(extracted.country);
  const credential = filled(extracted.credential);
  if (!applicant || !institution || !country || !credential) return null;
  if (extracted.years.length === 0) return null;

  const flat: RawCourse[] = [];
  for (const year of extracted.years) {
    if (!filled(year.year) || year.courses.length === 0) return null;
    for (const course of year.courses) {
      const originalName = filled(course.originalName);
      const englishName = filled(course.englishName);
      const localGrade = filled(course.localGrade);
      if (!originalName || !englishName || !localGrade) return null;
      flat.push({ originalName, englishName, localCredits: course.localCredits, localGrade });
    }
  }

  const scored = scoreCourses(flat, extracted.scale, options?.edgeRows);
  if (!scored) return null;

  let index = 0;
  const years = [];
  for (const year of extracted.years) {
    const courses = scored.courses.slice(index, index + year.courses.length);
    index += year.courses.length;
    years.push({ year: year.year.trim(), courses });
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
  };
}

async function extractDiploma(text: string): Promise<DiplomaExtract> {
  return generateObject(diplomaSchema, [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Extract each degree from this credential document.
Return one credential per degree that is printed. Copy names, institutions, countries, fields, and dates as printed.
credential is the degree title as printed (for example Licence, Licenciatura, Licenciada, Licenciado, Maîtrise, Bachillerato).
field is the subject. For "Licenciada en Administración de Empresas", field is "Administración de Empresas".
country is the country of the institution. If the country is not printed, infer it from the city or state (Guadalajara, Jalisco is Mexico). Use an empty string only when no place is printed.
dates is the examination or conferral date as printed.
Return the student's granted title even when a field is missing. Do not add degrees for the rector or other signatories. Do not invent a degree.

Document text:
${text.slice(0, 12000)}`,
        },
      ],
    },
  ]);
}

async function extractCourses(text: string): Promise<CourseExtract> {
  return generateObject(courseSchema, [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Extract this academic transcript into a course-by-course table.
Group courses by the academic year printed on the page. Keep each year label as printed.
originalName is the course title as printed. englishName is the English name.
localCredits and localGrade are the values as printed. localGrade is a string.
scale is "10" when grades are out of 10, "20" when grades are out of 20, and "letter" when grades are already A–F.
Do not convert grades. Do not invent courses.

Document text:
${text.slice(0, 12000)}`,
        },
      ],
    },
  ]);
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
  credential: EdgeCredentialRecord | null;
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

async function proposeEquivalency(printed: string, hit: EdgeHit): Promise<string> {
  if (!hit.credential) {
    return chooseEquivalency({ matched: false, edgeUsEquivalency: null, ai: null, printed });
  }
  let ai: { usEquivalency: string; confident: boolean } | null = null;
  try {
    ai = await generateObject(equivalencySchema, [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: edgeEquivalencyPrompt({
              country: hit.credential.country,
              printedTitle: printed,
              edgeTitle: hit.credential.title,
              levelNumber: hit.credential.levelNumber,
              levelTitle: hit.credential.levelTitle,
              contentExcerpt: edgeContentExcerpt(hit.credential.content, 1200),
              usEquivalencyHint: hit.credential.usEquivalency,
              gradingRows: hit.scale?.rows ?? [],
            }),
          },
        ],
      },
    ]);
  } catch (error) {
    console.error("edge equivalency proposal failed", error);
  }
  return chooseEquivalency({
    matched: true,
    edgeUsEquivalency: hit.credential.usEquivalency,
    ai,
    printed,
  });
}

async function buildEvaluatedResult(
  db: Db,
  service: "diploma" | "course_by_course",
  extracted: DiplomaExtract | CourseExtract,
  degreeCount: number,
  documentsReviewed: string[],
): Promise<{ result: EvaluationResult | null; edgeCredentialId: string | null; edgeGradingScaleId: string | null }> {
  if (service === "diploma") {
    const diploma = extracted as DiplomaExtract;
    const catalogs = new Map<string, { credentials: EdgeCredentialRecord[]; scales: EdgeGradingScaleRecord[] }>();
    const hits: EdgeHit[] = [];
    for (const item of diploma.credentials) {
      const slug = countrySlug(item.country);
      if (!catalogs.has(slug)) catalogs.set(slug, await edgeCatalog(db, item.country));
      const catalog = catalogs.get(slug) ?? { credentials: [], scales: [] };
      hits.push({
        credential: matchEdgeCredential(catalog.credentials, { country: item.country, title: item.credential }),
        scale: matchEdgeGradingScale(catalog.scales, { country: item.country, title: item.credential, grades: [] }),
      });
    }
    const equivalencies: string[] = [];
    for (let index = 0; index < diploma.credentials.length; index += 1) {
      const printed = diploma.credentials[index]?.credential ?? "";
      equivalencies.push(await proposeEquivalency(printed, hits[index] ?? { credential: null, scale: null }));
    }
    const credential = hits.find((hit) => hit.credential)?.credential ?? null;
    const scale = hits.find((hit) => hit.scale)?.scale ?? null;
    return {
      result: assembleDiploma({ extracted: diploma, degreeCount, documentsReviewed, equivalencies }),
      edgeCredentialId: credential?.id ?? null,
      edgeGradingScaleId: scale?.id ?? null,
    };
  }

  const courses = extracted as CourseExtract;
  const catalog = await edgeCatalog(db, courses.country);
  const grades = courses.years.flatMap((year) => year.courses.map((course) => course.localGrade));
  const hit: EdgeHit = {
    credential: matchEdgeCredential(catalog.credentials, { country: courses.country, title: courses.credential }),
    scale: matchEdgeGradingScale(catalog.scales, { country: courses.country, title: courses.credential, grades }),
  };
  const proposed = await proposeEquivalency(courses.credential, hit);
  const courseEquivalency = hit.credential ? proposed : (usEquivalency(courses.credential) ?? undefined);
  return {
    result: assembleCourse(courses, {
      edgeRows: hit.scale?.rows,
      ...(courseEquivalency ? { usEquivalency: courseEquivalency } : {}),
    }),
    edgeCredentialId: hit.credential?.id ?? null,
    edgeGradingScaleId: hit.scale?.id ?? null,
  };
}

export async function completeEvaluation(
  db: Db,
  order: OrderRecord,
  input: EvaluationContext,
): Promise<void> {
  if (!order.service || order.degreeCount == null) return;
  const service = order.service;
  const degreeCount = order.degreeCount;
  const language = input.languagesDisagree ? null : input.sourceLanguage;

  const quoteFor = (source: string | null) =>
    source
      ? evaluationQuote({
          service,
          degreeCount,
          sourceLanguage: source,
          billablePages: input.billablePages,
        })
      : null;

  const hold = async (reason: string, pricedLanguage: string | null) => {
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
      evaluation_cents: quote?.evaluationCents ?? null,
      translation_cents: quote?.translationCents ?? null,
      total_cents: quote?.totalCents ?? null,
    });
  };

  if (input.imageQuality) {
    await hold(IMAGE_QUALITY_REASON, language);
    return;
  }
  if (!languageConfirmed(input, language)) {
    await hold(LANGUAGE_REASON, language);
    return;
  }

  const version = await nextPreviewVersion(db, order.id);
  const { reportPath } = evaluationPreviewObjects(order.id, version);
  const inserted = await insertPreview(db, { orderId: order.id, version, previewPath: reportPath });
  if (inserted === "exists") return;

  try {
    const extracted =
      service === "diploma" ? await extractDiploma(input.pageText) : await extractCourses(input.pageText);
    const built = await buildEvaluatedResult(db, service, extracted, degreeCount, input.filenames);
    const result = built.result;
    if (!result) {
      await markPreview(db, order.id, version, "failed");
      await hold(UNMAPPED_REASON, language);
      await updateOrder(db, order.id, {
        edge_credential_id: built.edgeCredentialId,
        edge_grading_scale_id: built.edgeGradingScaleId,
      });
      return;
    }

    const pending =
      result.kind === "diploma"
        ? diplomaEquivalencyPending(result.credentials)
        : result.usEquivalency === PENDING_EQUIVALENCY;
    const files = await renderEvaluationPdfs(result, {
      reportId: evaluationReportId(order.id),
      issued: evaluationIssuedLabel(order.createdAt),
    });
    const stored: EvaluationResult = { ...result, pageCount: files.pageCount };
    const cleanPath = `${order.id}/evaluation-v${version}.pdf`;
    if (!pending) await uploadObject(db, FINALS_BUCKET, cleanPath, files.clean, "application/pdf");
    await uploadObject(db, PREVIEWS_BUCKET, reportPath, files.preview, "application/pdf");
    const quote = quoteFor(language);
    await updateOrder(db, order.id, {
      status: "preview_ready",
      review_reason: pending ? EQUIVALENCY_UNMAPPED : null,
      eta_at: null,
      source_language: language,
      language_confirmed: true,
      billable_pages: input.billablePages,
      combined_original_path: input.combinedPath,
      page_order_basis: input.pageOrderBasis,
      page_order: input.pageOrder,
      evaluation_cents: quote?.evaluationCents ?? null,
      translation_cents: quote?.translationCents ?? null,
      total_cents: quote?.totalCents ?? null,
      evaluation_result: stored,
      edge_credential_id: built.edgeCredentialId,
      edge_grading_scale_id: built.edgeGradingScaleId,
      ...(pending
        ? {}
        : {
            final_translation_path: cleanPath,
            certification_path: cleanPath,
          }),
    });
    await markPreview(db, order.id, version, "ready");
    await storeTranslationPreview(db, order, version, language);
    await insertEvent(db, order.id, "preview_ready", { version, pageCount: files.pageCount });
    const { notifyLifecycle } = await import("./webhook-delivery");
    await notifyLifecycle(db, order.id, "order.preview_ready");
    const email = await customerEmail(db, order.customerId);
    if (email) {
      await sendPreviewReady(email, {
        token: input.token,
        orderId: order.id,
        sourceLanguage: language,
        targetLanguage: order.targetLanguage,
        documentCount: input.filenames.length,
        pageCount: input.billablePages,
        totalCents: quote?.totalCents ?? null,
        includesTranslation: (quote?.translationCents ?? 0) > 0,
      });
    }
  } catch (error) {
    await markPreview(db, order.id, version, "failed");
    if (error instanceof AiUnavailableError) {
      await hold(READ_REASON, language);
      return;
    }
    const message = error instanceof Error ? error.message : READ_REASON;
    await hold(message, language);
  }
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
