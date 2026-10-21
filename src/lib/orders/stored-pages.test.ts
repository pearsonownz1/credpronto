import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import * as storage from "./storage";
import { withQuotedPages } from "./stored-pages";
import type { DocumentRecord, OrderRecord } from "./types";

function order(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    includeTranslation: true,
    service: "diploma",
    billablePages: null,
    id: "order-1",
    ...patch,
  } as OrderRecord;
}

function document(pageCount: number | null): DocumentRecord {
  return {
    id: "doc-1",
    orderId: "order-1",
    originalPath: "order-1/diploma.pdf",
    filename: "diploma.pdf",
    mime: "application/pdf",
    size: 1200,
    pageCount,
    status: "uploaded",
    detectedLanguage: null,
    confidence: null,
    position: 1,
    appliedPosition: null,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("quoted pages for combined checkout", () => {
  it("keeps an evaluation-only order from reading the upload again", async () => {
    const download = vi.spyOn(storage, "downloadObject");
    const listed = vi.spyOn(db, "listDocuments");
    const current = order({ includeTranslation: false, billablePages: null });
    await expect(withQuotedPages({} as db.Db, current)).resolves.toBe(current);
    expect(download).not.toHaveBeenCalled();
    expect(listed).not.toHaveBeenCalled();
  });

  it("reuses a page count already stored on the order", async () => {
    const listed = vi.spyOn(db, "listDocuments");
    const priced = await withQuotedPages({} as db.Db, order({ billablePages: 1 }));
    expect(priced.billablePages).toBe(1);
    expect(listed).not.toHaveBeenCalled();
  });

  it("copies document page counts onto the order", async () => {
    vi.spyOn(db, "listDocuments").mockResolvedValue([document(1)]);
    const update = vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    const download = vi.spyOn(storage, "downloadObject");
    const priced = await withQuotedPages({} as db.Db, order());
    expect(priced.billablePages).toBe(1);
    expect(update).toHaveBeenCalledWith(expect.anything(), "order-1", { billable_pages: 1 });
    expect(download).not.toHaveBeenCalled();
  });

  it("counts the uploaded pdf when neither the order nor the document has a page count", async () => {
    const bytes = new Uint8Array(
      readFileSync(join(__dirname, "__fixtures__", "zh_chusheng-yixue-zhengming.pdf")),
    );
    const proxy = await getDocumentProxy(bytes.slice());
    const pages = proxy.numPages;
    vi.spyOn(db, "listDocuments").mockResolvedValue([document(null)]);
    vi.spyOn(db, "updateDocument").mockResolvedValue();
    vi.spyOn(db, "updateOrder").mockResolvedValue(true);
    vi.spyOn(storage, "downloadObject").mockResolvedValue(bytes);
    const priced = await withQuotedPages({} as db.Db, order());
    expect(pages).toBeGreaterThan(0);
    expect(priced.billablePages).toBe(pages);
    expect(db.updateDocument).toHaveBeenCalledWith(expect.anything(), "doc-1", { page_count: pages });
    expect(db.updateOrder).toHaveBeenCalledWith(expect.anything(), "order-1", { billable_pages: pages });
  });
});
