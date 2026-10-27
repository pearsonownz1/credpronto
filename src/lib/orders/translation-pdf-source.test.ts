import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractSinglePdfPage, modelSourceBytes } from "./analysis";
import * as ai from "./ai";
import type { Db } from "./db";
import * as photo from "./pdf/photo";
import * as storage from "./storage";
import { runTranslationPage } from "./translation";
import * as jobs from "./translation-jobs";
import type { PageJobOutput, PageJobRecord, PageWork } from "./translation-jobs";
import type { OrderRecord } from "./types";

const orderId = "2485f011-d813-414f-b784-72254ff77e8b";
const jobId = "aaaaaaaa-1111-4111-8111-111111111111";
const documentId = "bbbbbbbb-1111-4111-8111-111111111111";
const pageId = "cccccccc-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

class MemoryDb {
  tables: Record<string, Row[]> = {};

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new Query(this, table);
  }
}

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private mode: "many" | "maybeSingle" = "many";

  constructor(
    private db: MemoryDb,
    private table: string,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row[column]));
    return this;
  }

  order() {
    return this;
  }

  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<TResult1 = { data: unknown; error: { message: string } | null }, TResult2 = never>(
    onFulfilled?: ((value: { data: unknown; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const found = (this.db.tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row)));
    const result =
      this.mode === "maybeSingle"
        ? { data: found[0] ?? null, error: found.length > 1 ? { message: "multiple rows" } : null }
        : { data: found, error: null };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

function orderRow(): Row {
  return {
    id: orderId,
    customer_id: "cust-1",
    status: "processing",
    source_language: "es",
    target_language: "en",
    language_confirmed: true,
    service_type: "translation",
    order_type: "translation",
    progress: { step: "translating", pagesRead: 1, pagesTotal: 1 },
  };
}

function documentRow(mime: string, originalPath: string): Row {
  return {
    id: documentId,
    order_id: orderId,
    original_path: originalPath,
    filename: "diploma.pdf",
    mime,
    size: 20,
    page_count: 2,
    status: "ready",
    position: 0,
  };
}

function pageRow(uploadPage: number): Row {
  return {
    id: pageId,
    document_id: documentId,
    page_number: 1,
    upload_page: uploadPage,
    word_count: 40,
    billable_units: 1,
    billing_basis: "words",
    ocr_text: "Diploma",
    needs_review: false,
    width_pt: 842,
    height_pt: 1190,
  };
}

function jobRow(): Row {
  return {
    id: jobId,
    order_id: orderId,
    version: 1,
    document_id: documentId,
    page_id: pageId,
    page_number: 1,
    combined_page_number: 1,
    status: "running",
    attempts: 1,
    output: null,
    error: null,
  };
}

function runRow(): Row {
  return {
    order_id: orderId,
    version: 1,
    status: "running",
    page_count: 1,
    round: 0,
    token: null,
    qa_issues: [],
  };
}

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const front = doc.addPage();
  front.drawText("FRONT PAGE ALPHA", { x: 72, y: 700, size: 18, font });
  const back = doc.addPage();
  back.drawText("BACK PAGE BETA", { x: 72, y: 700, size: 18, font });
  return doc.save();
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(Uint8Array.from(bytes));
  const extracted = await extractText(proxy, { mergePages: true });
  return Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
}

describe("PDF page source for translation", () => {
  it("attaches a PDF original and still attaches a photo", async () => {
    const db = new MemoryDb();
    db.tables.orders = [orderRow()];
    db.tables.translation_runs = [runRow()];
    db.tables.translation_page_jobs = [jobRow()];
    db.tables.document_pages = [pageRow(2)];
    db.tables.documents = [documentRow("application/pdf", `${orderId}/diploma.pdf`)];

    const pdf = await jobs.loadPageWork(db as unknown as Db, jobId);
    expect(pdf?.source).toEqual({ mime: "application/pdf", path: `${orderId}/diploma.pdf` });
    expect(pdf?.page.uploadPage).toBe(2);
    expect(pdf?.page.pageNumber).toBe(1);

    db.tables.documents = [documentRow("image/jpeg", `${orderId}/scan.jpg`)];
    const photoWork = await jobs.loadPageWork(db as unknown as Db, jobId);
    expect(photoWork?.source).toEqual({ mime: "image/jpeg", path: `${orderId}/scan.jpg` });

    db.tables.documents = [documentRow("application/pdf", "")];
    expect((await jobs.loadPageWork(db as unknown as Db, jobId))?.source).toBeNull();

    db.tables.documents = [documentRow("application/msword", `${orderId}/notes.doc`)];
    expect((await jobs.loadPageWork(db as unknown as Db, jobId))?.source).toBeNull();
  });

  it("copies one PDF page for the model and leaves images alone", async () => {
    const pdf = await twoPagePdf();
    const back = await extractSinglePdfPage(pdf, 1);
    expect((await PDFDocument.load(back)).getPageCount()).toBe(1);
    expect(await pdfText(back)).toContain("BACK PAGE BETA");
    expect(await pdfText(back)).not.toContain("FRONT PAGE ALPHA");
    await expect(extractSinglePdfPage(pdf, 4)).rejects.toThrow(/outside/);

    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    await expect(modelSourceBytes(png, "image/png", 3)).resolves.toEqual({ bytes: png, mime: "image/png" });
    const extracted = await modelSourceBytes(pdf, "application/pdf", 0);
    expect(extracted.mime).toBe("application/pdf");
    expect(await pdfText(extracted.bytes)).toContain("FRONT PAGE ALPHA");
  });
});

const CERTIFICATE_OCR = `UNION OF TURKISH BAR ASSOCIATIONS
ATTORNEY AT LAW LICENSE
THIS IS A LONG CAPITALIZED LINE THAT IS DEFINITELY LONGER THAN EIGHTY CHARACTERS FOR THE CERTIFICATE BODY TEXT
Union No.: 24379`;

function claimed(): PageJobRecord {
  return {
    id: jobId,
    orderId,
    version: 1,
    documentId,
    pageId,
    pageNumber: 1,
    combinedPageNumber: 1,
    status: "running",
    attempts: 1,
    output: null,
    sourceLanguage: "es",
    targetLanguage: "en",
    error: null,
    updatedAt: "2026-10-27T10:00:00.000Z",
  };
}

function work(): PageWork {
  return {
    job: claimed(),
    run: {
      orderId,
      version: 1,
      status: "running",
      pageCount: 1,
      round: 0,
      token: null,
      qaIssues: [],
      updatedAt: "2026-10-27T10:00:00.000Z",
    },
    order: {
      id: orderId,
      status: "processing",
      sourceLanguage: "es",
      targetLanguage: "en",
      progress: { step: "translating", pagesRead: 1, pagesTotal: 1 },
    } as OrderRecord,
    filename: "diploma.pdf",
    page: {
      id: pageId,
      documentId,
      pageNumber: 1,
      number: 1,
      wordCount: 40,
      billableUnits: 1,
      billingBasis: "words",
      ocrText: CERTIFICATE_OCR,
      needsReview: false,
      widthPt: 842,
      heightPt: 1190,
      uploadPage: 2,
      logicalPage: null,
      orderHint: null,
      qualityScore: 0.9,
      qualityFlags: [],
      qualityMessage: null,
    },
    fields: [],
    corrections: [],
    qaIssues: [],
    source: { mime: "application/pdf", path: `${orderId}/diploma.pdf` },
  };
}

describe("translation attaches the scanned PDF page", () => {
  let saved: PageJobOutput | undefined;

  beforeEach(() => {
    saved = undefined;
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("sends the upload page, not the reading-order page, and does not crop a PDF", async () => {
    const pdf = await twoPagePdf();
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed());
    vi.spyOn(jobs, "loadPageWork").mockResolvedValue(work());
    vi.spyOn(jobs, "completePageJob").mockImplementation(async (_db, _job, output) => {
      saved = output;
    });
    vi.spyOn(jobs, "failPageJob").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(pdf);
    const crop = vi.spyOn(photo, "cropHolderPhoto");

    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const content = (messages as Array<{ content?: Array<{ type?: string; text?: string }> }>)[0]?.content ?? [];
      const text = content.find((part) => part.type === "text")?.text ?? "";
      if (text.includes("Check this certified translation")) return { fixes: [] };
      if (text.includes("Translate each numbered part")) throw new Error("restore skipped");
      return { pageNumber: 1, kind: "certificate", blocks: [{ type: "paragraph", text: "Graduate in Biotechnology" }] };
    });

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    const first = vi.mocked(ai.generateObject).mock.calls[0]?.[1] as Array<{
      content?: Array<{ type?: string; mediaType?: string; data?: Uint8Array }>;
    }>;
    const file = first?.[0]?.content?.find((part) => part.type === "file");
    expect(file?.mediaType).toBe("application/pdf");
    expect(file?.data).toBeInstanceOf(Uint8Array);
    expect((await PDFDocument.load(file!.data!)).getPageCount()).toBe(1);
    expect(await pdfText(file!.data!)).toContain("BACK PAGE BETA");
    expect(await pdfText(file!.data!)).not.toContain("FRONT PAGE ALPHA");
    expect(crop).not.toHaveBeenCalled();
    expect(saved?.blocks.length).toBeGreaterThan(0);
    expect(jobs.failPageJob).not.toHaveBeenCalled();
  });
});
