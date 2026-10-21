import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "./ai";
import * as db from "./db";
import * as email from "./email";
import type { Db } from "./storage";
import * as storage from "./storage";
import { runTranslationPage } from "./translation";
import * as jobs from "./translation-jobs";
import type { PageJobOutput, PageJobRecord, PageWork } from "./translation-jobs";
import type { OrderRecord } from "./types";

const orderId = "e2e4c959-3ab9-4899-96a7-00f135b779a0";
const jobId = "aaaaaaaa-1111-4111-8111-111111111111";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const OYAK_OCR = `OYAK BANK
İstanbul, 31/1/2006
Bankacılık Düzenleme ve Denetleme Kurumu
Kuruluşlar III Dairesi Başkanlığı
Atatürk Bulvarı No: 191 06684
Kavaklıdere / Ankara
Evrak No : 74
Konu : Atama İşlemi
Bankamıza Baş Hukuk Müşaviri olarak atanması söz konusu olan Sn. Çiğdem DAYAN'a ilişkin belgeler ekte yer almaktadır.
Saygılarımızla,
OYAK BANK A.Ş.
Genel Müdürlük
E. Hakan Eminsoy
Genel Müdür ve Yönetim Kurulu Üyesi
Nejat Bilginer
Genel Müdür Yardımcısı
Ek: 1) Belge bir.
2) Belge iki.`;

const OYAK_WALL =
  "OYAK BANK Istanbul, 01/31/2006 Banking Regulation and Supervision Agency Department III of Institutions Atatürk Bulvarı No: 191 06684 Kavaklıdere / Ankara Document No: 74 Subject: Appointment Procedure The documents pertaining to Ms. Çiğdem DAYAN, whose appointment as Chief Legal Advisor to our Bank is under consideration, are attached hereto. Sincerely, OYAK BANK A.Ş. Head Office E. Hakan Eminsoy General Manager and Member of the Board of Directors Nejat Bilginer Assistant General Manager Encl.: 1) Bankruptcy certificate. 2) Concordat certificate.";

function claimed(): PageJobRecord {
  return {
    id: jobId,
    orderId,
    version: 1,
    documentId: "bbbbbbbb-1111-4111-8111-111111111111",
    pageId: "cccccccc-1111-4111-8111-111111111111",
    pageNumber: 1,
    combinedPageNumber: 1,
    status: "running",
    attempts: 1,
    output: null,
    sourceLanguage: "tr",
    targetLanguage: "en",
    error: null,
    updatedAt: "2026-10-21T10:23:00.000Z",
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
      updatedAt: "2026-10-21T10:23:00.000Z",
    },
    order: {
      id: orderId,
      status: "processing",
      sourceLanguage: "tr",
      targetLanguage: "en",
      progress: { step: "translating", pagesRead: 1, pagesTotal: 1 },
      staffAlertSentAt: null,
    } as OrderRecord,
    filename: "Screenshot 2026-10-21 at 2.42.59 AM.png",
    page: {
      id: "cccccccc-1111-4111-8111-111111111111",
      documentId: "bbbbbbbb-1111-4111-8111-111111111111",
      pageNumber: 1,
      number: 1,
      wordCount: 136,
      billableUnits: 1,
      billingBasis: "words",
      ocrText: OYAK_OCR,
      needsReview: false,
      widthPt: 612,
      heightPt: 792,
      uploadPage: 1,
      logicalPage: null,
      orderHint: null,
      qualityScore: 0.9,
      qualityFlags: [],
      qualityMessage: null,
    },
    fields: [],
    corrections: [],
    qaIssues: [],
    source: { mime: "image/png", path: `${orderId}/letter.png` },
  };
}

function messageText(call: readonly unknown[]): string {
  const messages = call[1] as Array<{ content?: Array<{ type?: string; text?: string }> }>;
  const content = messages[0]?.content ?? [];
  return content.find((part) => part.type === "text")?.text ?? "";
}

function hasImage(call: readonly unknown[]): boolean {
  const messages = call[1] as Array<{ content?: Array<{ type?: string; mediaType?: string }> }>;
  return (messages[0]?.content ?? []).some((part) => part.type === "file" && part.mediaType === "image/png");
}

describe("photo translation layout", () => {
  let saved: PageJobOutput | undefined;

  beforeEach(() => {
    saved = undefined;
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(jobs, "claimPageJob").mockResolvedValue(claimed());
    vi.spyOn(jobs, "loadPageWork").mockResolvedValue(work());
    vi.spyOn(jobs, "completePageJob").mockImplementation(async (_db, _job, output) => {
      saved = output;
    });
    vi.spyOn(jobs, "failPageJob").mockResolvedValue(undefined);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(PNG);
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(db, "getOrderById").mockResolvedValue({ id: orderId, status: "processing" } as OrderRecord);
    vi.spyOn(email, "sendTranslationFailureAlert").mockResolvedValue({ sent: true, skipped: false });
  });

  it("sends the screenshot and restores the letter when the model returns one paragraph", async () => {
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = messageText([_schema, messages]);
      if (text.includes("Check this certified translation")) return { fixes: [] };
      if (text.includes("Translate each numbered part")) {
        throw new Error("the source lines already locate the letter");
      }
      return { pageNumber: 1, kind: "letter", blocks: [{ type: "paragraph", text: OYAK_WALL }] };
    });

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(storage.downloadObject).toHaveBeenCalledWith(expect.anything(), "originals", `${orderId}/letter.png`);
    const first = vi.mocked(ai.generateObject).mock.calls[0] ?? [];
    expect(hasImage(first)).toBe(true);
    expect(messageText(first)).toContain("Do not join those regions into one paragraph");
    expect(saved?.layoutFallback).toBe("source-lines");
    expect(saved?.kind).toBe("letter");
    expect(saved?.blocks.map((block) => block.type)).toEqual([
      "logo",
      "paragraph",
      "address",
      "address",
      "kv",
      "kv",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "signature",
      "signature",
      "list",
    ]);
    const signatures = saved?.blocks.filter((block) => block.type === "signature") ?? [];
    expect(signatures.map((block) => (block.type === "signature" ? block.column : ""))).toEqual(["left", "right"]);
    expect(console.warn).toHaveBeenCalledWith(
      "layout fallback: restored the source arrangement",
      expect.objectContaining({ via: "source-lines", kind: "letter" }),
    );
    expect(jobs.failPageJob).not.toHaveBeenCalled();
  });

  it("warns when the screenshot cannot be attached and still translates the transcription", async () => {
    vi.spyOn(storage, "downloadObject").mockRejectedValue(new Error("missing"));
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = messageText([_schema, messages]);
      if (text.includes("Check this certified translation")) return { fixes: [] };
      return {
        pageNumber: 1,
        kind: "letter",
        blocks: [
          { type: "logo", text: "OYAK BANK" },
          { type: "paragraph", text: "Istanbul, 01/31/2006" },
          { type: "kv", label: "Document No.", value: "74" },
          { type: "paragraph", text: "The documents are attached." },
          { type: "signature", electronic: false, column: "left", lines: ["E. Hakan Eminsoy"] },
        ],
      };
    });

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    const first = vi.mocked(ai.generateObject).mock.calls[0] ?? [];
    expect(hasImage(first)).toBe(false);
    expect(saved?.layoutFallback).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      "layout fallback: source image was not attached",
      expect.objectContaining({ filename: "Screenshot 2026-10-21 at 2.42.59 AM.png", message: "missing" }),
    );
  });

  it("keeps a structured letter from the model and does not flag a fallback", async () => {
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = messageText([_schema, messages]);
      if (text.includes("Check this certified translation")) return { fixes: [] };
      return {
        pageNumber: 1,
        kind: "letter",
        blocks: [
          { type: "logo", text: "OYAK BANK" },
          { type: "paragraph", text: "Istanbul, 01/31/2006" },
          { type: "kv", label: "Document No.", value: "74" },
          { type: "paragraph", text: "The documents are attached." },
          { type: "signature", electronic: false, column: "left", lines: ["E. Hakan Eminsoy"] },
        ],
      };
    });

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(ai.generateObject).toHaveBeenCalledTimes(2);
    expect(saved?.layoutFallback).toBeUndefined();
    expect(saved?.blocks.some((block) => block.type === "logo")).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("flags a flat paragraph when the source arrangement cannot be recovered", async () => {
    vi.spyOn(ai, "generateObject").mockImplementation(async (_schema, messages) => {
      const text = messageText([_schema, messages]);
      if (text.includes("Check this certified translation")) return { fixes: [] };
      if (text.includes("Translate each numbered part")) return { parts: [] };
      return { pageNumber: 1, kind: "letter", blocks: [{ type: "paragraph", text: "Hello from the bank." }] };
    });

    await runTranslationPage({} as Db, { orderId, version: 1, jobId });

    expect(saved?.layoutFallback).toBe("flat");
    expect(saved?.blocks).toEqual([{ type: "paragraph", text: "Hello from the bank." }]);
    expect(console.warn).toHaveBeenCalledWith(
      "layout fallback: kept a flat paragraph",
      expect.objectContaining({ via: "flat", kind: "letter" }),
    );
  });
});
