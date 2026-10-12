import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeOrder } from "./analysis";
import * as ai from "./ai";
import { quotePages } from "./billing";
import { UNIT_PRICE_CENTS } from "./constants";
import * as db from "./db";
import { partnerQuoteAction } from "./partner";
import * as storage from "./storage";
import * as webhooks from "./webhook-delivery";
import type { DocumentRecord, OrderRecord } from "./types";

const orderId = "28492f38-2222-4222-8222-222222222222";
const dbHandle = {} as db.Db;

/** Brazilian licenciatura diploma. Accents are stripped so the standard PDF font can draw it. */
const DIPLOMA = [
  "REPUBLICA FEDERATIVA DO BRASIL",
  "MINISTERIO DA EDUCACAO",
  "UNIVERSIDADE FEDERAL DO RIO DE JANEIRO",
  "DIPLOMA DE LICENCIATURA",
  "O Reitor da Universidade Federal do Rio de Janeiro, no uso de suas atribuicoes legais",
  "e tendo em vista a conclusao do curso de Licenciatura em Pedagogia e a colacao de grau,",
  "confere o titulo de Licenciada em Pedagogia a Maria Aparecida dos Santos",
  "e lhe outorga o presente diploma para que possa gozar de todos os direitos e prerrogativas legais.",
].join(" ");

const ENGLISH =
  "This is to certify that the following diploma is a true copy of the academic record and that the degree was conferred.";

const LABEL = "UPS SHIP TO Ada Lovelace TRACKING NUMBER 1Z999AA10123456784";

async function diplomaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([612, 792]);
  first.drawText(DIPLOMA, { x: 48, y: 700, size: 11, font, maxWidth: 516 });
  doc.addPage([612, 792]);
  return doc.save();
}

function installOrder(bytes: Uint8Array) {
  vi.spyOn(db, "getOrderById").mockResolvedValue({
    id: orderId,
    status: "draft",
    languageConfirmed: false,
    service: null,
    degreeCount: null,
    targetLanguage: "en",
    sourceLanguage: "pt",
  } as OrderRecord);
  vi.spyOn(db, "claimDocuments").mockResolvedValue([
    {
      id: "doc-1",
      orderId,
      originalPath: `${orderId}/diploma.pdf`,
      filename: "pt-br_diploma-licenciatura.pdf",
      mime: "application/pdf",
      position: 1,
    } as DocumentRecord,
  ]);
  vi.spyOn(db, "setOrderProgress").mockResolvedValue(undefined);
  vi.spyOn(db, "replacePages").mockResolvedValue(undefined);
  vi.spyOn(db, "updateDocument").mockResolvedValue(undefined);
  vi.spyOn(db, "replaceExtractedConfirmations").mockResolvedValue(undefined);
  vi.spyOn(db, "updateOrder").mockResolvedValue(true);
  vi.spyOn(db, "hasEvent").mockResolvedValue(false);
  vi.spyOn(db, "insertEvent").mockResolvedValue(undefined);
  vi.spyOn(db, "markDocuments").mockResolvedValue(undefined);
  vi.spyOn(storage, "downloadObject").mockResolvedValue(bytes);
  vi.spyOn(storage, "uploadObject").mockResolvedValue(undefined);
  vi.spyOn(webhooks, "notifyOrder").mockResolvedValue(undefined);
}

describe("API quote for a Brazilian licenciatura diploma", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("bills the diploma and leaves English, blank, and label pages free", () => {
    const quote = quotePages([DIPLOMA, "", ENGLISH, LABEL], "en");
    expect(quote.lineItems).toEqual([
      { pageIndex: 0, billableUnits: 1, skip: false, skipReason: null },
      { pageIndex: 1, billableUnits: 0, skip: true, skipReason: "blank" },
      { pageIndex: 2, billableUnits: 0, skip: true, skipReason: "english" },
      { pageIndex: 3, billableUnits: 0, skip: true, skipReason: "label" },
    ]);
    expect(quote.billablePages).toBe(1);
    expect(quote.totalCents).toBe(UNIT_PRICE_CENTS);
  });

  it("quotes a diploma with a blank verso instead of quote_unavailable", async () => {
    const bytes = await diplomaPdf();
    installOrder(bytes);
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const prompt = JSON.stringify(messages);
      if (prompt.includes("unreadable") || prompt.includes("logicalPage")) {
        return {
          pages: [
            {
              pageNumber: 1,
              text: DIPLOMA,
              unreadable: false,
              confidence: 0.95,
              logicalPage: 1,
              orderHint: "",
              orderConfidence: 0,
              legibility: 1,
              flags: [],
            },
            {
              pageNumber: 2,
              text: "",
              unreadable: true,
              confidence: 1,
              logicalPage: 0,
              orderHint: "",
              orderConfidence: 0,
              legibility: 1,
              flags: [],
            },
          ],
        };
      }
      return {
        language: "pt",
        confidence: 0.96,
        full_name: "Maria Aparecida dos Santos",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "Rio de Janeiro",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);

    const stored = vi.mocked(db.replacePages).mock.calls[0]?.[2];
    expect(stored?.map((page) => ({ skipped: page.skipped, skipReason: page.skipReason }))).toEqual([
      { skipped: false, skipReason: null },
      { skipped: true, skipReason: "blank" },
    ]);

    const patch = vi.mocked(db.updateOrder).mock.calls.at(-1)?.[2] as {
      status: string;
      billable_pages: number;
      total_cents: number;
      review_reason: string | null;
    };
    expect(patch).toMatchObject({
      status: "quoted",
      billable_pages: 1,
      total_cents: UNIT_PRICE_CENTS,
      review_reason: null,
    });
    expect(
      partnerQuoteAction({
        status: patch.status,
        billablePages: patch.billable_pages,
        totalCents: patch.total_cents,
        reviewReason: patch.review_reason,
        sourceLanguage: "pt",
        service: "translation",
      }),
    ).toBe("use");
  });

  it("still withholds a quote when a billed page could not be read", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const short = "Licenciatura em Pedagogia. Universidade Federal confere o titulo a Maria dos Santos.";
    const page = doc.addPage([612, 792]);
    page.drawText(short, { x: 48, y: 700, size: 12, font, maxWidth: 516 });
    installOrder(await doc.save());
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const prompt = JSON.stringify(messages);
      if (prompt.includes("unreadable") || prompt.includes("logicalPage")) {
        return {
          pages: [
            {
              pageNumber: 1,
              text: short,
              unreadable: true,
              confidence: 0.2,
              logicalPage: 0,
              orderHint: "",
              orderConfidence: 0,
              legibility: 1,
              flags: [],
            },
          ],
        };
      }
      return {
        language: "pt",
        confidence: 0.96,
        full_name: "",
        date_of_birth: "",
        parent_names: "",
        place_of_birth: "",
        date_format: "",
      };
    });

    await analyzeOrder(dbHandle, orderId);
    const patch = vi.mocked(db.updateOrder).mock.calls.at(-1)?.[2] as {
      status: string;
      billable_pages: number;
      total_cents: number;
      review_reason: string | null;
    };
    expect(patch.status).toBe("needs_review");
    expect(patch.review_reason).toContain("could not be read clearly");
    expect(patch.billable_pages).toBe(1);
    expect(patch.total_cents).toBe(UNIT_PRICE_CENTS);
    expect(
      partnerQuoteAction({
        status: patch.status,
        billablePages: patch.billable_pages,
        totalCents: patch.total_cents,
        reviewReason: patch.review_reason,
        sourceLanguage: "pt",
        service: "translation",
      }),
    ).toBe("unavailable");
  });
});
