import { z } from "zod";
import type { ModelMessage } from "ai";
import { generateObject, translationModelId } from "./ai";
import { imageBytesForModel } from "./analysis";
import { ORIGINALS_BUCKET } from "./constants";
import { inReadingOrder } from "./page-order";
import { CONFIRMATION_FIELD_KEYS } from "./fields";
import { pageKind, type PageKind, type RenderBlock, type RenderPage } from "./pdf/layout";
import { coverClientName, coverDocuments, coverSignature, coverTranslatorName, loadTranslatorSignature } from "./pdf/cover";
import { gcsCoverClientName, isGcsOrder } from "./gcs";
import { releaseFreeGcsOrder } from "./gcs-release";
import { storeCertifiedTranslation } from "./final-file";
import { documentKind } from "./pdf/document-layout";
import { reconcileIdentifiers, verifyIdentifiers } from "./pdf/identifiers";
import { cropHolderPhoto } from "./pdf/photo";
import { renderOrderPdfs } from "./pdf/render";
import {
  blocksFromSegmentTranslations,
  completeLetterFromSource,
  ensurePortrait,
  layoutNeedsRestore,
  projectLetter,
  segmentSource,
  translatedProse,
} from "./pdf/source-mirror";
import { blocksFromModel, blocksToParagraphs, formBlocksWhenCollapsed, type ModelBlock } from "./pdf/structure";
import { segmentsInSourceOrder } from "./segment-source";
import {
  claimOrderColumn,
  clearOrderColumn,
  customerEmail,
  orderCustomerEmail,
  getOrderById,
  insertEvent,
  insertQaRun,
  insertTranslation,
  latestReadyPreview,
  listConfirmations,
  listCorrections,
  listDocuments,
  listPages,
  markPreview,
  resolveCorrections,
  updateOrder,
  withCombinedNumbers,
  type Db,
} from "./db";
import { adminStudioLink, sendPreviewReady, sendTranslationFailureAlert } from "./email";
import { humanReviewReason } from "./review-reason";
import { AiUnavailableError, HttpError } from "./errors";
import { QA_REVIEW_REASON, assessTranslation, qaAttemptForRound, qaStatusForRun, qaWillRetry, type QaIssue } from "./qa";
import {
  TRANSLATION_DEADLINE_MS,
  TRANSLATION_PAGE_DEADLINE_MS,
  canRetryFailedTranslation,
  TRANSLATION_TIMEOUT_REASON,
  decideTranslationFailure,
  isTemporaryTranslationError,
  raceWorkAgainstDeadline,
} from "./translation-failure";
import { OPEN_TRANSLATION_STATUSES, checkedProgress } from "./translation-watch";
import {
  beginTranslation,
  claimAssemble,
  claimPageJob,
  completePageJob,
  failPageJob,
  failTranslationOrder,
  findOpenRun,
  getTranslationRun,
  listPageJobs,
  loadOrderPages,
  loadPageWork,
  markRunFailed,
  markRunReady,
  reconcileOpenTranslation,
  releaseSkippedPageJob,
  resumeTranslation,
  type LayoutFallback,
  type PageJobOutput,
} from "./translation-jobs";
import { isSkippedTranslationPage, pageTranslationPhrases, passThroughBlocks, pagesToTranslate } from "./translation-pages";
import { staffAlertRecipients } from "./release-decision";
import { downloadObject, uploadObject } from "./storage";
import type { ConfirmationRecord, CorrectionRecord, PageRecord } from "./types";

const modelBlockSchema = z.object({
  type: z.string(),
  text: z.string().nullish(),
  level: z.number().nullish(),
  electronic: z.boolean().nullish(),
  rows: z.array(z.object({ label: z.string(), value: z.string() })).nullish(),
  lines: z.array(z.string()).nullish(),
  align: z.string().nullish(),
  column: z.string().nullish(),
  bold: z.boolean().nullish(),
  underline: z.boolean().nullish(),
  caps: z.boolean().nullish(),
  label: z.string().nullish(),
  value: z.string().nullish(),
  items: z.array(z.string()).nullish(),
  ordered: z.boolean().nullish(),
  cells: z.array(z.array(z.string())).nullish(),
  caption: z.string().nullish(),
});

const modelPageSchema = z.object({
  pageNumber: z.number(),
  kind: z.string().nullish(),
  blocks: z.array(modelBlockSchema).optional(),
  lines: z.array(z.string()).optional(),
  paragraphs: z.array(z.string()).optional(),
});

const translationSchema = z.object({
  pages: z.array(modelPageSchema),
});

const repairSchema = z.object({
  parts: z.array(z.object({ id: z.number(), text: z.string() })),
});

const IMAGE_LAYOUT_NOTE =
  "The attached image is the source page. Mirror its arrangement: letterhead, date, address, each reference line, the body, each signature, and the enclosure list. Do not join those regions into one paragraph.";

type ModelPage = {
  pageNumber: number;
  kind?: string | null;
  blocks?: ModelBlock[];
  lines?: string[];
  paragraphs?: string[];
};

const LAYOUT_INSTRUCTIONS = `Also set kind to "letter", "certificate", or "form".
A letter has a letterhead, an address, a subject line, prose, and a sign-off. A certificate or license has a centered title, boxed numbers, a portrait, seals, and a signature. A form is a list of labeled fields. Keep a form on type "fields". Do not turn a form into a letter or a certificate.

For a letter or a certificate, return blocks in reading order. One source page is one translated page.
- heading: a title. align center on a certificate. bold true on the main title. caps true when the source title is in capitals.
- paragraph: prose. align justify for a letter body. Wrap source bold in **double asterisks** and source underline in __double underscores__. caps true when the source paragraph is in capitals.
- address: the postal lines.
- kv: one label and one value that is not inside a bordered grid, such as Document No. and 74 on a letter. These are not a table.
- box: one bordered number sitting alone, such as a union number beside a portrait. label, value, and column left or right.
- list: attachments. ordered true. items are the lines. label is the heading, such as Attachment.
- logo: the letterhead name only, such as OYAK BANK. Do not transcribe the artwork.
- photo: the holder's portrait. caption is Holder's photo. Do not describe the face.
- signature: a handwritten signature. electronic false. column left or right when two signatures sit side by side. lines are the printed name and title under the ink, with ** around a bold name. Do not copy the ink. When two or three signatures share one horizontal row, emit them as consecutive signature blocks.
- seal: a round seal. text is a short place name, or empty when the place cannot be read. column left or right when two seals sit on opposite sides.
- stamp: a rectangular stamp. text is the short wording, or empty.
- handwritten: a handwritten note that is not a signature.
- illegible: a mark that cannot be read.
- table: a bordered table, grid, or horizontal row of boxed cells. cells are rows of strings. Whenever the source page shows a bordered table, a grid, or a horizontal strip of boxed registration fields (a row of 3 to 5 registration-number boxes at the top or bottom of a diploma or certificate, or any ruled key-value table), preserve that grid as a table. Do not flatten those cells into kv, box, or fields. Use a header row of the field labels and a second row of the values when the labels sit above the numbers. Use one row of cells written as "Label: Value" when the label and value share one box. An empty label is an empty cell, never a leading colon.

Copy every number and ID exactly. Keep diacritics in names. Turkish, Spanish, French, German, and Portuguese dates are day/month/year on the source. Print every date as MM/DD/YYYY, so 31/1/2006 is 01/31/2006 and 7. 9. 1989 is 09/07/1989.`;

function pageHasContent(blocks: RenderBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === "paragraph" || block.type === "note" || block.type === "heading" || block.type === "logo" || block.type === "stamp" || block.type === "handwritten") {
      return block.text.trim().length > 0;
    }
    if (block.type === "fields") return block.rows.some((row) => row.label.trim() || row.value.trim());
    if (block.type === "kv" || block.type === "box") return Boolean(block.label.trim() || block.value.trim());
    if (block.type === "address") return block.lines.some((line) => line.trim().length > 0);
    if (block.type === "list") return block.items.some((item) => item.trim().length > 0) || Boolean(block.label?.trim());
    if (block.type === "table") return block.rows.some((row) => row.some((cell) => cell.trim().length > 0));
    if (block.type === "seal") return true;
    if (block.type === "signature" || block.type === "photo" || block.type === "illegible") return true;
    return false;
  });
}

function kindFor(page: ModelPage, blocks: RenderBlock[]): PageKind | undefined {
  return pageKind(page.kind) ?? documentKind({ blocks }) ?? undefined;
}

function strictDateFormat(fields: ConfirmationRecord[]): "MM/DD/YYYY" | "DD/MM/YYYY" {
  return dateFormatOf(fields) === "DD/MM/YYYY" ? "DD/MM/YYYY" : "MM/DD/YYYY";
}

function confirmedBlock(fields: ConfirmationRecord[]): string {
  return CONFIRMATION_FIELD_KEYS.map((key) => {
    const field = fields.find((item) => item.fieldKey === key);
    const value = field?.confirmedValue?.trim() ?? "";
    return `${key}: ${value || "(not on this document)"}`;
  }).join("\n");
}

function dateFormatOf(fields: ConfirmationRecord[]): string {
  const format = fields.find((field) => field.fieldKey === "date_format")?.confirmedValue?.trim();
  return format || "MM/DD/YYYY";
}

function alignPages(
  expected: number[],
  returned: ModelPage[],
): Array<{ pageNumber: number; blocks: RenderBlock[]; kind?: PageKind }> | null {
  const byNumber = new Map<number, { blocks: RenderBlock[]; kind?: PageKind }>();
  for (const page of returned) {
    const blocks = blocksFromModel(page);
    if (pageHasContent(blocks)) byNumber.set(Math.round(page.pageNumber), { blocks, kind: kindFor(page, blocks) });
  }
  if (expected.every((number) => byNumber.has(number))) {
    return expected.map((number) => {
      const found = byNumber.get(number);
      return { pageNumber: number, blocks: found?.blocks ?? [], kind: found?.kind };
    });
  }
  if (returned.length === expected.length && returned.every((page) => pageHasContent(blocksFromModel(page)))) {
    return expected.map((number, index) => {
      const page = returned[index] ?? {};
      const blocks = blocksFromModel(page);
      return { pageNumber: number, blocks, kind: kindFor(page, blocks) };
    });
  }
  return null;
}

async function translateDocument(
  input: {
    filename: string;
    sourceLanguage: string;
    fields: ConfirmationRecord[];
    pages: Array<PageRecord & { number: number }>;
    corrections: CorrectionRecord[];
    qaIssues: QaIssue[];
  },
  signal?: AbortSignal,
) {
  const notes = input.corrections
    .map((correction) => {
      const page = input.pages.find((item) => item.number === correction.pageNumber);
      if (!page) return null;
      const highlighted = correction.passage ? ` Highlighted text: "${correction.passage}".` : "";
      return `Page ${correction.pageNumber}.${highlighted} Change: ${correction.note ?? ""}`;
    })
    .filter((note): note is string => Boolean(note));

  const pageText = input.pages
    .map((page) => `Page ${page.number}:\n${(page.ocrText ?? "").slice(0, 6000)}`)
    .join("\n\n");

  const qaNotes = input.qaIssues
    .map((item) => `Page ${item.page ?? "all"} (${item.type}): ${item.note} Original: ${item.original}`)
    .join("\n");

  const prompt = `Translate this document into English, one original page to one translated page.
Source language: ${input.sourceLanguage}.
File: ${input.filename}.

Use these confirmed spellings exactly whenever the person, the parents, the birthplace, or the date of birth appears. Do not invent a name that was confirmed as absent.
Write every date in the translation, including the date of birth, using this format: ${dateFormatOf(input.fields)}.

Confirmed fields:
${confirmedBlock(input.fields)}

${notes.length ? `The customer asked for these corrections:\n${notes.join("\n")}` : "There are no correction notes."}

${qaNotes ? `A previous translation failed QA. Fix every item and keep confirmed names, dates, and numbers:\n${qaNotes}` : "There are no QA notes."}

Return one object per page number, with blocks in the original top-to-bottom order.
Keep names, CURPs, and place spellings exactly as printed or confirmed. Do not join a label and its value into a paragraph.

For a form, use type "fields" and rows of {label, value}. Translate labels into English. One row per field, in the original order. A line-broken reading (type "lines", one label or value per line) is acceptable when you cannot split a row.

For prose, use type "paragraph" and preserve paragraph breaks.

For a seal, stamp, coat of arms, or letter-spaced ring such as "C I V I L  R E G I S T R Y", use type "seal" and set text to a short place description such as "Civil Registry of Jalisco". Do not copy ring text, and do not letter-space it.

For a handwritten signature, use type "signature" with electronic false.
For an electronic signature, firma electrónica, or a long unbroken signature token, use type "signature" with electronic true. Do not copy the signature string.

For a section title, use type "heading".
${LAYOUT_INSTRUCTIONS}
${pageText}`;

  const expected = input.pages.map((page) => page.number);
  const deadline = signal ?? AbortSignal.timeout(TRANSLATION_DEADLINE_MS);
  let last: ModelPage[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
    try {
      const result = await generateObject(
        translationSchema,
        [{ role: "user", content: [{ type: "text", text: prompt }] }],
        deadline,
      );
      last = result.pages as ModelPage[];
      const aligned = alignPages(expected, last);
      if (aligned) return restoreDocumentPages(input, aligned, deadline);
    } catch (error) {
      if (!isTemporaryTranslationError(error) || attempt === 1 || deadline.aborted) throw error;
    }
  }
  const fallback = alignPages(expected, last);
  if (fallback) return restoreDocumentPages(input, fallback, deadline);
  throw new HttpError("The translation did not return every page.", 502);
}

function userMessages(text: string, image?: { bytes: Uint8Array; mime: string }): ModelMessage[] {
  const content: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; data: Uint8Array }> = [
    { type: "text", text },
  ];
  if (image) content.push({ type: "file", mediaType: image.mime, data: image.bytes });
  return [{ role: "user", content }];
}

function reportLayout(via: LayoutFallback, detail: { filename: string; kind: string }): void {
  const message = via === "flat" ? "layout fallback: kept a flat paragraph" : "layout fallback: restored the source arrangement";
  console.warn(message, { ...detail, via });
}

async function restoreCollapsedLayout(input: {
  sourceText: string;
  blocks: RenderBlock[];
  kind?: PageKind;
  filename: string;
  sourceLanguage: string;
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY";
  image?: { bytes: Uint8Array; mime: string };
  signal?: AbortSignal;
}): Promise<{ blocks: RenderBlock[]; kind?: PageKind; layoutFallback?: LayoutFallback }> {
  const detected = segmentSource(input.sourceText);
  let portrait = false;
  if (detected?.kind === "certificate" && input.image) {
    try {
      portrait = (await cropHolderPhoto(input.image.bytes)) != null;
    } catch {
      portrait = false;
    }
  }
  const plan = layoutNeedsRestore(input.sourceText, input.blocks, { portrait });
  if (!plan) {
    const blocks = ensurePortrait(input.blocks, portrait);
    const kind = input.kind ?? (blocks.some((block) => block.type === "photo") ? "certificate" : undefined);
    return { blocks: completeLetterFromSource(blocks, input.sourceText), kind };
  }

  const settle = (blocks: RenderBlock[]) =>
    reconcileIdentifiers({
      sourceText: input.sourceText,
      blocks: completeLetterFromSource(blocks, input.sourceText),
      sourceLanguage: input.sourceLanguage,
      dateFormat: input.dateFormat,
    });

  const finish = (blocks: RenderBlock[], via: LayoutFallback) => {
    reportLayout(via, { filename: input.filename, kind: plan.kind });
    return {
      blocks: settle(blocks),
      kind: plan.kind,
      layoutFallback: via,
    };
  };

  if (plan.kind === "letter") {
    const projected = projectLetter(plan.segments, translatedProse(input.blocks));
    if (projected) return finish(projected, "source-lines");
  }

  try {
    if (input.signal?.aborted) throw new AiUnavailableError("translation_timeout");
    const parts = plan.segments
      .map((segment) => `${segment.id}. ${segment.role}${segment.column ? ` (${segment.column})` : ""}: ${segment.text}`)
      .join("\n");
    const result = await generateObject(
      repairSchema,
      userMessages(
        `Translate each numbered part on its own into English. Do not merge parts.
Return one part for every id. A kv or box is "Label: value". An address, signature, or list keeps one line per source line.
Keep each personal name as printed, including initials. A list keeps a leading 1) marker when the source line has one.
A photo part is "Holder's photo". Copy numbers exactly. Write dates as ${input.dateFormat}.

Parts:
${parts}

Collapsed translation, for wording only:
${translatedProse(input.blocks).slice(0, 6000)}`,
        input.image,
      ),
      input.signal,
      { maxRetries: 0 },
    );
    const rebuilt = blocksFromSegmentTranslations(plan.segments, result.parts);
    if (rebuilt) return finish(rebuilt, "model");
    console.warn("layout fallback: segment translation did not assemble", {
      filename: input.filename,
      segments: plan.segments.length,
      parts: result.parts.length,
    });
  } catch (error) {
    console.warn("layout fallback: restore failed", {
      filename: input.filename,
      message: error instanceof Error ? error.message : "restore failed",
    });
  }
  reportLayout("flat", { filename: input.filename, kind: plan.kind });
  return { blocks: settle(input.blocks), kind: input.kind ?? plan.kind, layoutFallback: "flat" };
}

async function restoreDocumentPages(
  input: {
    filename: string;
    sourceLanguage: string;
    fields: ConfirmationRecord[];
    pages: Array<PageRecord & { number: number }>;
  },
  pages: Array<{ pageNumber: number; blocks: RenderBlock[]; kind?: PageKind }>,
  signal: AbortSignal,
): Promise<Array<{ pageNumber: number; blocks: RenderBlock[]; kind?: PageKind }>> {
  const restored = [];
  for (const page of pages) {
    const source = input.pages.find((item) => item.number === page.pageNumber);
    const next = await restoreCollapsedLayout({
      sourceText: source?.ocrText ?? "",
      blocks: page.blocks,
      kind: page.kind,
      filename: input.filename,
      sourceLanguage: input.sourceLanguage,
      dateFormat: strictDateFormat(input.fields),
      signal,
    });
    restored.push({ pageNumber: page.pageNumber, blocks: next.blocks, kind: next.kind });
  }
  return restored;
}

/** One billable page. The caller retries the invocation once; this call does not. */
async function translateOnePage(input: {
  filename: string;
  sourceLanguage: string;
  targetLanguage: string;
  fields: ConfirmationRecord[];
  page: PageRecord & { number: number };
  corrections: CorrectionRecord[];
  qaIssues: QaIssue[];
  image?: { bytes: Uint8Array; mime: string };
}): Promise<{ blocks: RenderBlock[]; kind?: PageKind; layoutFallback?: LayoutFallback }> {
  const notes = input.corrections
    .filter((correction) => correction.pageNumber === input.page.number)
    .map((correction) => {
      const highlighted = correction.passage ? ` Highlighted text: "${correction.passage}".` : "";
      return `Page ${correction.pageNumber}.${highlighted} Change: ${correction.note ?? ""}`;
    });
  const qaNotes = input.qaIssues
    .map((item) => `Page ${item.page ?? "all"} (${item.type}): ${item.note} Original: ${item.original}`)
    .join("\n");
  const phrases = pageTranslationPhrases(input.targetLanguage);
  const prompt = `${phrases.lead}
Source language: ${input.sourceLanguage}.
File: ${input.filename}.

Use these confirmed spellings exactly whenever the person, the parents, the birthplace, or the date of birth appears. Do not invent a name that was confirmed as absent.
Write every date in the translation, including the date of birth, using this format: ${dateFormatOf(input.fields)}.

Confirmed fields:
${confirmedBlock(input.fields)}

${notes.length ? `The customer asked for these corrections:\n${notes.join("\n")}` : "There are no correction notes."}

${qaNotes ? `A previous translation failed QA. Fix every item and keep confirmed names, dates, and numbers:\n${qaNotes}` : "There are no QA notes."}

Return one page object for page ${input.page.number}, with blocks in the original top-to-bottom order.
Keep names, CURPs, and place spellings exactly as printed or confirmed. Do not join a label and its value into a paragraph.

For a form, use type "fields" and rows of {label, value}. ${phrases.labels} One row per field, in the original order. A line-broken reading (type "lines", one label or value per line) is acceptable when you cannot split a row.

For prose, use type "paragraph" and preserve paragraph breaks.

For a seal, stamp, coat of arms, or letter-spaced ring such as "C I V I L  R E G I S T R Y", use type "seal" and set text to a short place description such as "Civil Registry of Jalisco". Do not copy ring text, and do not letter-space it.

For a handwritten signature, use type "signature" with electronic false.
For an electronic signature, firma electrónica, or a long unbroken signature token, use type "signature" with electronic true. Do not copy the signature string.

For a section title, use type "heading".
${LAYOUT_INSTRUCTIONS}
${input.image ? `${IMAGE_LAYOUT_NOTE}\n` : ""}Page ${input.page.number}:
${(input.page.ocrText ?? "").slice(0, 6000)}`;

  const deadline = AbortSignal.timeout(TRANSLATION_PAGE_DEADLINE_MS);
  const result = await raceWorkAgainstDeadline(
    generateObject(
      z.union([modelPageSchema, z.object({ pages: z.array(modelPageSchema).min(1) })]),
      userMessages(prompt, input.image),
      deadline,
      { maxRetries: 0 },
    ),
    deadline,
  );
  const page = ("pages" in result ? result.pages[0] : result) as ModelPage | undefined;
  if (!page) throw new HttpError("The translation did not return the page.", 502);
  const aligned = alignPages([input.page.number], [page]);
  if (!aligned?.[0]) throw new HttpError("The translation did not return the page.", 502);
  const recovered = formBlocksWhenCollapsed(input.page.ocrText ?? "", aligned[0].blocks);
  const dateFormat = strictDateFormat(input.fields);
  const verified = await verifyIdentifiers({
    sourceText: input.page.ocrText ?? "",
    blocks: recovered ?? aligned[0].blocks,
    sourceLanguage: input.sourceLanguage,
    dateFormat,
  });
  return restoreCollapsedLayout({
    sourceText: input.page.ocrText ?? "",
    blocks: verified,
    kind: recovered ? "form" : aligned[0].kind,
    filename: input.filename,
    sourceLanguage: input.sourceLanguage,
    dateFormat,
    image: input.image,
    signal: deadline,
  });
}

/** Write a terminal status when a translation is still Processing or waiting on the first preview. */
export async function recordTranslationFailure(db: Db, orderId: string, error: unknown): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order) return;
  const translating = order.progress?.step === "translating";
  const stuck =
    order.status === "processing" ||
    (translating && (order.status === "confirmed" || order.status === "correction_requested"));
  if (!stuck) return;
  const open = (await listCorrections(db, orderId)).filter((correction) => correction.status === "open");
  const decision = decideTranslationFailure({
    error,
    readyPreview: (await latestReadyPreview(db, orderId)) != null,
    openCorrections: open.length > 0,
  });
  const wrote = await updateOrder(
    db,
    orderId,
    {
      status: decision.status,
      review_reason: decision.reviewReason,
      progress: checkedProgress(order.progress, { step: "done" }),
    },
    { statuses: OPEN_TRANSLATION_STATUSES },
  );
  if (wrote === false || !decision.notifyFailed) return;
  const { notifyOrder } = await import("./webhook-delivery");
  await notifyOrder(db, orderId, "order.failed");
}

/**
 * Starts one function invocation per billable page. Skipped pages are not translated.
 * The layout and watermarked preview run in a later invocation, after every page is ready.
 * The deadline fires before maxDuration so a hung start still writes status and review_reason.
 */
export async function translateOrder(db: Db, orderId: string, token: string | null): Promise<void> {
  const deadline = AbortSignal.timeout(TRANSLATION_DEADLINE_MS);
  try {
    await raceWorkAgainstDeadline(startPageTranslation(db, orderId, token), deadline);
  } catch (error) {
    await recordTranslationFailure(db, orderId, error);
    if (!isTemporaryTranslationError(error)) throw error;
  }
}

async function startPageTranslation(db: Db, orderId: string, token: string | null): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order) return;
  const open = (await listCorrections(db, orderId)).filter((correction) => correction.status === "open");
  if (order.status === "preview_ready" && open.length === 0) return;
  if (
    order.status === "approved" ||
    order.status === "delivered" ||
    order.status === "cancelled" ||
    (order.status === "paid" && order.finalTranslationPath)
  ) {
    return;
  }
  if (!order.languageConfirmed || !order.sourceLanguage) {
    throw new HttpError("Confirm the language and the name fields before translation.", 409);
  }

  // The failed attempt leaves its run open. Resuming it finishes stale jobs and
  // never clears status. A new version makes those jobs a no-op.
  if (canRetryFailedTranslation(order)) {
    await beginTranslation(db, order, token, { round: 0, qaIssues: [], retryFailure: true });
    return;
  }

  const openRun = await findOpenRun(db, orderId);
  if (openRun) {
    await reconcileOpenTranslation(db, order, openRun);
    await resumeTranslation(db, openRun);
    return;
  }
  await beginTranslation(db, order, token, { round: 0, qaIssues: [] });
}

export async function runTranslationPage(
  db: Db,
  input: { orderId: string; version: number; jobId: string },
): Promise<void> {
  const claimed = await claimPageJob(db, input.jobId);
  if (!claimed || claimed.orderId !== input.orderId || claimed.version !== input.version) return;
  try {
    const work = await loadPageWork(db, claimed.id);
    if (!work?.order.sourceLanguage) {
      if (await releaseSkippedPageJob(db, claimed)) return;
      throw new HttpError("The page is not ready to translate.", 409);
    }
    let image: { bytes: Uint8Array; mime: string } | undefined;
    if (work.source) {
      try {
        const raw = await downloadObject(db, ORIGINALS_BUCKET, work.source.path);
        image = await imageBytesForModel(raw, work.source.mime);
      } catch (error) {
        console.warn("layout fallback: source image was not attached", {
          filename: work.filename,
          message: error instanceof Error ? error.message : "download failed",
        });
      }
    }
    const translated = await translateOnePage({
      filename: work.filename,
      sourceLanguage: work.order.sourceLanguage,
      targetLanguage: work.order.targetLanguage,
      fields: work.fields,
      page: work.page,
      corrections: work.corrections,
      qaIssues: work.qaIssues,
      image,
    });
    const output: PageJobOutput = {
      blocks: translated.blocks,
      paragraphs: blocksToParagraphs(translated.blocks),
      ...(translated.kind ? { kind: translated.kind } : {}),
      ...(translated.layoutFallback ? { layoutFallback: translated.layoutFallback } : {}),
    };
    await completePageJob(db, claimed, output);
  } catch (error) {
    await failPageJob(db, claimed, error);
    await ensurePageFailureReviewed(db, claimed.orderId, error);
  }
}

/** A page or assemble failure, including unreadable JSON, flags the order at once. */
async function ensurePageFailureReviewed(db: Db, orderId: string, error: unknown): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order) return;
  // failTranslationOrder may have just written failed. That row still moves to needs_review.
  // Cancelled, delivered, paid, approved, and preview_ready stay where they are.
  const open = (OPEN_TRANSLATION_STATUSES as readonly string[]).includes(order.status);
  if (!open && order.status !== "needs_review" && order.status !== "failed") return;
  const raw = error instanceof Error ? error.message : "Translation failed.";
  const reviewReason = isTemporaryTranslationError(error)
    ? TRANSLATION_TIMEOUT_REASON
    : (humanReviewReason(raw) ?? "Translation failed.");
  if (order.status !== "needs_review" || order.reviewReason !== reviewReason) {
    const statuses = order.status === "failed" ? [...OPEN_TRANSLATION_STATUSES, "failed"] : OPEN_TRANSLATION_STATUSES;
    const wrote = await updateOrder(
      db,
      orderId,
      {
        status: "needs_review",
        review_reason: reviewReason,
        progress: checkedProgress(order.progress, { step: "done" }),
      },
      { statuses },
    );
    if (wrote === false) return;
  }
  await alertStaffForHeldTranslation(db, orderId, reviewReason);
}

async function alertStaffForHeldTranslation(db: Db, orderId: string, reviewReason: string): Promise<void> {
  const order = await getOrderById(db, orderId);
  if (!order || order.staffAlertSentAt) return;
  const at = new Date().toISOString();
  const claimed = await claimOrderColumn(db, order.id, "staff_alert_sent_at", at);
  if (!claimed) return;
  try {
    const recipients = staffAlertRecipients();
    if (recipients.length === 0) {
      await clearOrderColumn(db, order.id, "staff_alert_sent_at", at);
      return;
    }
    const result = await sendTranslationFailureAlert(recipients, {
      orderId: order.id,
      reason: humanReviewReason(reviewReason) ?? "Translation failed.",
      studioUrl: adminStudioLink(order.id),
    });
    if (!result.sent) await clearOrderColumn(db, order.id, "staff_alert_sent_at", at);
  } catch (error) {
    await clearOrderColumn(db, order.id, "staff_alert_sent_at", at);
    console.error(error instanceof Error ? error.message : "staff alert failed");
  }
}

export async function runTranslationAssemble(
  db: Db,
  input: { orderId: string; version: number },
): Promise<void> {
  const run = await getTranslationRun(db, input.orderId, input.version);
  if (!run || run.status === "ready" || run.status === "failed") return;
  const order = await getOrderById(db, input.orderId);
  if (!order?.sourceLanguage || !order.languageConfirmed) return;
  if (order.status === "cancelled" || order.status === "delivered" || order.status === "approved") return;
  const claimed = await claimAssemble(db, input.orderId, input.version);
  if (!claimed) return;

  const sourceLanguage = order.sourceLanguage;
  const open = (await listCorrections(db, input.orderId)).filter((correction) => correction.status === "open");

  try {
    const deadline = AbortSignal.timeout(TRANSLATION_DEADLINE_MS);
    await raceWorkAgainstDeadline(
      (async () => {
        const { documents, pages } = await loadOrderPages(db, input.orderId);
        const jobs = await listPageJobs(db, input.orderId, input.version);
        const ready = new Map(jobs.filter((job) => job.status === "ready" && job.output).map((job) => [job.pageId, job]));
        const billable = pagesToTranslate(pages);
        if (billable.some((page) => !ready.get(page.id)?.output)) {
          throw new HttpError("The translation did not return every page.", 502);
        }

        const renderedPages: RenderPage[] = [];
        const translatedCounts = new Map<string, number>();
        const translatedText = new Map<string, string>();
        const model = translationModelId();
        for (const document of documents) {
          const documentPages = pages.filter((page) => page.documentId === document.id);
          const stored = documentPages.map((page) => {
            if (isSkippedTranslationPage(page)) {
              const blocks = passThroughBlocks(page.ocrText);
              return {
                page,
                blocks,
                paragraphs: blocksToParagraphs(blocks),
                kind: undefined as PageKind | undefined,
                layoutFallback: undefined as LayoutFallback | undefined,
              };
            }
            const job = ready.get(page.id);
            if (!job?.output) throw new HttpError("The translation did not return every page.", 502);
            return {
              page,
              blocks: job.output.blocks,
              paragraphs: job.output.paragraphs,
              kind: job.output.kind,
              layoutFallback: job.output.layoutFallback,
            };
          });
          await insertTranslation(db, {
            documentId: document.id,
            version: input.version,
            model,
            status: "ready",
            output: {
              pages: stored.map((page) => ({
                pageNumber: page.page.pageNumber,
                combinedPageNumber: page.page.number,
                paragraphs: segmentsInSourceOrder(page.page.ocrText, page.paragraphs),
                blocks: page.blocks,
                ...(page.kind ? { kind: page.kind } : {}),
                ...(page.layoutFallback ? { layoutFallback: page.layoutFallback } : {}),
              })),
            },
          });
          translatedCounts.set(document.id, documentPages.length);
          translatedText.set(document.id, stored.map((page) => page.paragraphs.join("\n")).join("\n"));
          for (const page of stored) {
            const kind = page.kind ?? documentKind({ blocks: page.blocks }) ?? undefined;
            renderedPages.push({
              combinedPageNumber: page.page.number,
              widthPt: page.page.widthPt ?? 612,
              heightPt: page.page.heightPt ?? 792,
              paragraphs: page.paragraphs,
              blocks: page.blocks,
              ...(kind ? { kind } : {}),
              photoPng: await holderPhoto(db, document, page.blocks),
            });
          }
        }

        const today = new Date().toISOString().slice(0, 10);
        const configuredSignature = loadTranslatorSignature();
        const confirmations = await listConfirmations(db, input.orderId);
        const clientEmail = await customerEmail(db, order.customerId);
        const previewPath = `${input.orderId}/preview-v${input.version}.pdf`;
        const gcs = isGcsOrder(order);
        const files = await renderOrderPdfs({
          orderId: input.orderId,
          sourceLanguage,
          targetLanguage: order.targetLanguage,
          date: today,
          pages: renderedPages,
          brand: gcs ? "gcs" : "credpronto",
          clientName: gcs ? gcsCoverClientName(confirmations) : coverClientName(confirmations, clientEmail),
          documents: coverDocuments(documents, pages, translatedCounts, translatedText),
          translatorName: coverTranslatorName(null),
          signature: coverSignature(null, configuredSignature),
          pricedPages: order.billablePages,
          degreeCount: order.degreeCount,
        });
        const translationPath = await storeCertifiedTranslation(db, {
          orderId: input.orderId,
          version: input.version,
          cleanTranslation: files.cleanTranslation,
          combinedOriginalPath: order.combinedOriginalPath,
          appendOriginal: !gcs,
          stampVerification: !gcs,
        });
        const certificationPath = translationPath;
        await uploadObject(db, "previews", previewPath, files.watermarkedPreview, "application/pdf");
        if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
        const active = await getTranslationRun(db, input.orderId, input.version);
        if (!active || active.status === "failed" || active.status === "ready") return;

        const assessment = assessTranslation({
          originalPages: pages.map((page) => ({ number: page.number, text: page.ocrText ?? "", documentId: page.documentId })),
          translatedPages: renderedPages.map((page) => ({
            number: page.combinedPageNumber,
            text: files.pageTexts.find((painted) => painted.number === page.combinedPageNumber)?.text ?? "",
          })),
          confirmations,
        });
        const attempt = qaAttemptForRound(run.round);
        const status = qaStatusForRun({ pass: assessment.pass, attempt });
        await insertQaRun(db, {
          orderId: input.orderId,
          attempt,
          status,
          score: assessment.score,
          issues: assessment.pass ? [] : assessment.issues,
        });
        const current = await getOrderById(db, input.orderId);
        const keepPaid = current?.status === "paid";
        if (!assessment.pass) {
          const retrying = jobs.length > 0 && qaWillRetry({ pass: false, attempt });
          // A free GCS order still opens in the editor after QA retries, so the translator can fix wording.
          if (retrying || !gcs) {
            await markPreview(db, input.orderId, input.version, "failed");
            await markRunFailed(db, input.orderId, input.version);
          }
          if (retrying) {
            if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
            const fresh = await getOrderById(db, input.orderId);
            if (!fresh) return;
            await beginTranslation(db, fresh, run.token, { round: run.round + 1, qaIssues: assessment.issues });
            return;
          }
          if (!gcs) {
            if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
            const wrote = await updateOrder(
              db,
              input.orderId,
              {
                status: "needs_review",
                review_reason: QA_REVIEW_REASON,
                progress: checkedProgress(order.progress, { step: "done" }),
              },
              { statuses: OPEN_TRANSLATION_STATUSES },
            );
            if (wrote === false && !keepPaid) return;
            if (wrote) await alertStaffForHeldTranslation(db, input.orderId, QA_REVIEW_REASON);
            if (keepPaid || current?.paidAt) {
              const { settlePaidOrder } = await import("./paid-release");
              await settlePaidOrder(db, input.orderId);
            }
            return;
          }
        }

        await markPreview(db, input.orderId, input.version, "ready");
        await updateOrder(db, input.orderId, {
          final_translation_path: translationPath,
          certification_path: certificationPath,
        });
        await resolveCorrections(db, open.map((correction) => correction.id), input.version);

        if (gcs) {
          const translatedCount = pagesToTranslate(pages).length;
          const settled = checkedProgress(order.progress, {
            step: "done",
            pagesDone: translatedCount,
            pagesTranslateTotal: translatedCount,
          });
          if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
          await releaseFreeGcsOrder(
            db,
            input.orderId,
            { finalPath: translationPath, certificationPath },
            settled,
          );
          await markRunReady(db, input.orderId, input.version);
          const { notifyLifecycle } = await import("./webhook-delivery");
          await notifyLifecycle(db, input.orderId, "order.preview_ready");
          return;
        }

        const previewEmail = await orderCustomerEmail(db, order.id);
        if (previewEmail) {
          await sendPreviewReady(previewEmail, {
            token: run.token,
            orderId: order.id,
            sourceLanguage,
            targetLanguage: order.targetLanguage,
            documentCount: documents.length,
            pageCount: order.billablePages,
            totalCents: order.totalCents,
            includesTranslation: true,
          });
        }
        if (!(await latestReadyPreview(db, input.orderId))) {
          throw new HttpError("Preview did not save.", 500);
        }
        await insertEvent(db, input.orderId, "preview_ready", { version: input.version });

        const stillOpen = (await listCorrections(db, input.orderId)).filter((correction) => correction.status === "open");
        const translatedCount = pagesToTranslate(pages).length;
        const settled = checkedProgress(order.progress, {
          step: "done",
          pagesDone: translatedCount,
          pagesTranslateTotal: translatedCount,
        });
        if (deadline.aborted) throw new AiUnavailableError("translation_timeout");
        if (stillOpen.length === 0) {
          await updateOrder(db, input.orderId, {
            ...(keepPaid ? {} : { status: "preview_ready" }),
            review_reason: null,
            progress: settled,
          });
        } else if (keepPaid) {
          await updateOrder(db, input.orderId, { progress: settled });
        } else {
          await updateOrder(db, input.orderId, { status: "correction_requested", progress: settled });
        }
        await markRunReady(db, input.orderId, input.version);
        const { notifyLifecycle } = await import("./webhook-delivery");
        await notifyLifecycle(db, input.orderId, "order.preview_ready");
        if (keepPaid || current?.paidAt) {
          const { settlePaidOrder } = await import("./paid-release");
          await settlePaidOrder(db, input.orderId);
        }
      })(),
      deadline,
    );
  } catch (error) {
    await failTranslationOrder(db, { orderId: input.orderId, version: input.version, error });
    await ensurePageFailureReviewed(db, input.orderId, error);
  }
}


/**
 * Watermarked certified-translation preview for an evaluation.
 * Same preview pass as a translation order: watermark on, certification cover off.
 * The clean translation and the certification page are not stored.
 */
export async function watermarkedTranslationPreview(
  db: Db,
  input: {
    orderId: string;
    sourceLanguage: string;
    targetLanguage: string;
    customerId: string;
  },
): Promise<Uint8Array> {
  const documents = inReadingOrder(await listDocuments(db, input.orderId));
  const pages = withCombinedNumbers(
    documents,
    await listPages(
      db,
      documents.map((document) => document.id),
    ),
  );
  if (pages.length === 0) throw new Error("The original pages are not ready to translate.");

  const confirmations = await listConfirmations(db, input.orderId);
  const clientEmail = await customerEmail(db, input.customerId);
  const renderedPages: RenderPage[] = [];
  const translatedCounts = new Map<string, number>();
  const translatedText = new Map<string, string>();
  for (const document of documents) {
    const documentPages = pages.filter((page) => page.documentId === document.id);
    if (documentPages.length === 0) continue;
    const billable = documentPages.filter((page) => !isSkippedTranslationPage(page));
    const translated = billable.length
      ? await translateDocument({
          filename: document.filename,
          sourceLanguage: input.sourceLanguage,
          fields: confirmations.filter((field) => field.documentId === document.id),
          pages: billable,
          corrections: [],
          qaIssues: [],
        })
      : [];
    const byNumber = new Map(translated.map((page) => [page.pageNumber, page]));
    translatedCounts.set(document.id, documentPages.length);
    const paragraphsForDocument: string[] = [];
    for (const page of documentPages) {
      const found = byNumber.get(page.number);
      const blocks = found?.blocks ?? passThroughBlocks(page.ocrText);
      const paragraphs = blocksToParagraphs(blocks);
      paragraphsForDocument.push(paragraphs.join("\n"));
      const kind = found?.kind ?? documentKind({ blocks }) ?? undefined;
      renderedPages.push({
        combinedPageNumber: page.number,
        widthPt: page.widthPt ?? 612,
        heightPt: page.heightPt ?? 792,
        paragraphs,
        blocks,
        ...(kind ? { kind } : {}),
        photoPng: await holderPhoto(db, document, blocks),
      });
    }
    translatedText.set(document.id, paragraphsForDocument.join("\n"));
  }
  if (renderedPages.length === 0) throw new Error("The original pages are not ready to translate.");

  const configuredSignature = loadTranslatorSignature();
  const files = await renderOrderPdfs({
    orderId: input.orderId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    date: new Date().toISOString().slice(0, 10),
    pages: renderedPages,
    clientName: coverClientName(confirmations, clientEmail),
    documents: coverDocuments(documents, pages, translatedCounts, translatedText),
    translatorName: coverTranslatorName(null),
    signature: coverSignature(null, configuredSignature),
  });
  return files.watermarkedPreview;
}

async function holderPhoto(
  db: Db,
  document: { mime: string | null; originalPath: string },
  blocks: RenderBlock[],
): Promise<Uint8Array | null> {
  if (!blocks.some((block) => block.type === "photo")) return null;
  if (!document.mime?.startsWith("image/") || !document.originalPath) return null;
  try {
    const bytes = await downloadObject(db, ORIGINALS_BUCKET, document.originalPath);
    return await cropHolderPhoto(bytes);
  } catch {
    return null;
  }
}
