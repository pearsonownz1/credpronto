import { beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "@/lib/auth/session";
import {
  getPreview,
  previewCacheControl,
  previewResponseHeaders,
} from "./preview-read";
import * as access from "./order-access";
import { orderForPreview } from "./order-access";
import * as db from "./db";
import { HttpError } from "./errors";
import * as storage from "./storage";
import { generateOrderToken, hashOrderToken } from "./token";
import type { Db } from "./storage";
import type { CorrectionRecord, PageRecord } from "./types";
import type { PreviewOrderRow } from "./db";

const orderId = "28492f38-1111-4111-8111-111111111111";
const token = generateOrderToken();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function previewOrder(patch: Partial<PreviewOrderRow> = {}): PreviewOrderRow {
  return {
    id: orderId,
    userId: "user-1",
    status: "preview_ready",
    totalCents: 8955,
    unitPriceCents: 995,
    billablePages: 9,
    combinedOriginalPath: `${orderId}/original.pdf`,
    service: null,
    orderType: "translation",
    evaluationCents: null,
    translationCents: null,
    includeTranslation: false,
    evaluationPageCount: null,
    ...patch,
    degreeCount: patch.degreeCount ?? null,
    addonCents: patch.addonCents ?? 0,
  };
}

function frame(pageNumber: number): PageRecord {
  return {
    id: `page-${pageNumber}`,
    documentId: "doc-1",
    pageNumber,
    wordCount: null,
    billableUnits: null,
    billingBasis: null,
    ocrText: null,
    needsReview: false,
    widthPt: 612,
    heightPt: 792,
    uploadPage: pageNumber,
    logicalPage: null,
    orderHint: null,
    qualityScore: null,
    qualityFlags: [],
    qualityMessage: null,
  };
}

const ninePages = Array.from({ length: 9 }, (_, index) => frame(index + 1));

describe("preview access", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as Db);
  });

  it("checks the session and the owner together, and still rejects the wrong owner", async () => {
    const userGate = deferred();
    const orderGate = deferred();
    let userStarted = false;
    let orderStarted = false;
    vi.spyOn(session, "requireUser").mockImplementation(async () => {
      userStarted = true;
      await userGate.promise;
      return { id: "user-1", email: "owner@example.com", emailVerified: true };
    });
    vi.spyOn(db, "getPreviewOrderById").mockImplementation(async () => {
      orderStarted = true;
      await orderGate.promise;
      return previewOrder();
    });

    const pending = orderForPreview(orderId);
    await vi.waitFor(() => {
      expect(userStarted).toBe(true);
      expect(orderStarted).toBe(true);
    });
    userGate.resolve();
    orderGate.resolve();
    await expect(pending).resolves.toMatchObject({ order: { id: orderId, userId: "user-1" } });

    vi.mocked(db.getPreviewOrderById).mockResolvedValue(previewOrder({ userId: "someone-else" }));
    await expect(orderForPreview(orderId)).rejects.toMatchObject({ status: 404, message: "Order not found" });
  });

  it("accepts only a hashed link token and does not ask for a session", async () => {
    const requireUser = vi.spyOn(session, "requireUser").mockRejectedValue(new HttpError("Sign in required", 401));
    const byHash = vi.spyOn(db, "requirePreviewOrderByHash").mockResolvedValue(previewOrder());

    await expect(orderForPreview("not-a-token")).rejects.toMatchObject({ status: 404 });
    expect(byHash).not.toHaveBeenCalled();
    expect(requireUser).not.toHaveBeenCalled();

    const found = await orderForPreview(token);
    expect(found.order.id).toBe(orderId);
    expect(requireUser).not.toHaveBeenCalled();
    expect(byHash).toHaveBeenCalledWith(expect.anything(), hashOrderToken(token));

    byHash.mockRejectedValue(new HttpError("Order not found", 404));
    await expect(orderForPreview(generateOrderToken())).rejects.toMatchObject({ status: 404 });
  });
});

describe("GET preview timing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the preview, pages, and corrections together, then signs once per bucket", async () => {
    vi.spyOn(db, "listReadyPreviewPaths").mockResolvedValue([]);
    const reads = deferred();
    let readsInFlight = 0;
    let maxReads = 0;
    const trackRead = async <T>(value: T): Promise<T> => {
      readsInFlight += 1;
      maxReads = Math.max(maxReads, readsInFlight);
      await reads.promise;
      readsInFlight -= 1;
      return value;
    };
    vi.spyOn(db, "latestReadyPreview").mockImplementation(() =>
      trackRead({ id: "preview-1", version: 3, previewPath: `${orderId}/preview-v3.pdf`, status: "ready" }),
    );
    vi.spyOn(db, "listPreviewFrames").mockImplementation(() =>
      trackRead({
        documents: [{ id: "doc-1", filename: "acta.pdf", position: 0, appliedPosition: null }],
        pages: ninePages,
      }),
    );
    const correction: CorrectionRecord = {
      id: "corr-1",
      documentId: "doc-1",
      pageNumber: 2,
      passage: "nombre",
      note: "spelling",
      status: "open",
      resolvedPreviewVersion: null,
      createdAt: "2026-10-12T00:00:00.000Z",
    };
    vi.spyOn(db, "listPreviewCorrections").mockImplementation(() => trackRead([correction]));

    const signs = deferred();
    let signsInFlight = 0;
    let maxSigns = 0;
    const buckets: string[] = [];
    vi.spyOn(storage, "signedObjectUrls").mockImplementation(async (_db, bucket, paths) => {
      signsInFlight += 1;
      maxSigns = Math.max(maxSigns, signsInFlight);
      buckets.push(bucket);
      await signs.promise;
      signsInFlight -= 1;
      return new Map(paths.map((path) => [path, `https://signed.example/${bucket}/${path}`]));
    });
    let eventStarted = false;
    vi.spyOn(db, "insertEvent").mockImplementation(async () => {
      eventStarted = true;
      signsInFlight += 1;
      maxSigns = Math.max(maxSigns, signsInFlight);
      await signs.promise;
      signsInFlight -= 1;
    });

    vi.spyOn(access, "orderForPreview").mockResolvedValue({
      db: {} as Db,
      order: previewOrder(),
      token,
    });

    const pending = getPreview(token);
    await vi.waitFor(() => expect(maxReads).toBe(3));
    expect(storage.signedObjectUrls).not.toHaveBeenCalled();
    expect(db.listReadyPreviewPaths).not.toHaveBeenCalled();
    reads.resolve();

    await vi.waitFor(() => expect(maxSigns).toBe(3));
    expect(eventStarted).toBe(true);
    signs.resolve();

    const preview = await pending;
    expect(preview.body.original.pages).toHaveLength(9);
    expect(preview.body.translation.pages).toHaveLength(9);
    expect(preview.body.translation.version).toBe(3);
    expect(preview.body.corrections).toEqual([
      {
        id: "corr-1",
        documentId: "doc-1",
        page: 2,
        quote: "nombre",
        note: "spelling",
        status: "open",
        createdAt: "2026-10-12T00:00:00.000Z",
      },
    ]);
    expect(preview.body.report).toBeNull();
    expect(buckets).toEqual(["originals", "previews"]);
    expect(storage.signedObjectUrls).toHaveBeenCalledTimes(2);
    expect(vi.mocked(storage.signedObjectUrls).mock.calls[0]?.[2]).toEqual([`${orderId}/original.pdf`]);
    expect(vi.mocked(storage.signedObjectUrls).mock.calls[1]?.[2]).toEqual([`${orderId}/preview-v3.pdf`]);
    expect(preview.serverTiming).toMatch(/lookup;dur=\d+, reads;dur=\d+, sign;dur=\d+, total;dur=\d+/);
    expect(preview.body.original.url).not.toMatch(/finals/);
    expect(preview.body.translation.url).not.toMatch(/finals/);
  });

  it("does not sign a finals path", async () => {
    vi.spyOn(access, "orderForPreview").mockResolvedValue({
      db: {} as Db,
      order: previewOrder({ combinedOriginalPath: `${orderId}/finals/translation-v1.pdf` }),
      token,
    });
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue({
      id: "preview-1",
      version: 1,
      previewPath: `${orderId}/preview-v1.pdf`,
      status: "ready",
    });
    vi.spyOn(db, "listPreviewFrames").mockResolvedValue({ documents: [], pages: [] });
    vi.spyOn(db, "listPreviewCorrections").mockResolvedValue([]);
    const sign = vi.spyOn(storage, "signedObjectUrls").mockResolvedValue(new Map());
    await expect(getPreview(token)).rejects.toThrow(/finals/);
    expect(sign).not.toHaveBeenCalled();
  });

  it("signs a stored GCS evaluation from finals with no watermarked preview path", async () => {
    const path = `${orderId}/course_by_course-evaluation.pdf`;
    vi.spyOn(access, "orderForPreview").mockResolvedValue({
      db: {} as Db,
      order: previewOrder({
        brand: "gcs",
        serviceFiles: { course_by_course: path },
        evaluationPageCount: 1,
      }),
      token,
    });
    vi.spyOn(db, "latestReadyPreview").mockResolvedValue({
      id: "preview-1",
      version: 3,
      previewPath: `${orderId}/preview-v3.pdf`,
      status: "ready",
    });
    vi.spyOn(db, "listPreviewFrames").mockResolvedValue({
      documents: [{ id: "doc-1", filename: "acta.pdf", position: 0, appliedPosition: null }],
      pages: ninePages,
    });
    vi.spyOn(db, "listPreviewCorrections").mockResolvedValue([]);
    vi.spyOn(db, "insertEvent").mockResolvedValue();
    vi.spyOn(storage, "signedObjectUrls").mockImplementation(async (_db, bucket, paths) => {
      return new Map(paths.map((item) => [item, `https://signed.example/${bucket}/${item}`]));
    });
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue(`https://signed.example/finals/${path}`);

    const preview = await getPreview(token);

    expect(preview.body.report).toEqual({
      url: `https://signed.example/finals/${path}`,
      pageCount: 1,
    });
    expect(preview.body.report?.url).not.toContain("preview-v3");
    expect(storage.signedObjectUrl).toHaveBeenCalledWith(expect.anything(), "finals", path, 600);
    expect(preview.body.translation.url).toContain("/previews/");
  });
});

describe("preview cache", () => {
  it("caches a link token briefly and never caches a session-gated order id", () => {
    expect(previewCacheControl(token)).toBe("private, max-age=15");
    expect(previewCacheControl(orderId)).toBe("private, no-store");
    expect(previewResponseHeaders(token, "total;dur=1")["Cache-Control"]).toBe("private, max-age=15");
    expect(previewResponseHeaders(orderId, "total;dur=1")).toMatchObject({
      "Cache-Control": "private, no-store",
      "Server-Timing": "total;dur=1",
    });
  });
});

describe("signed url batch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("signs every path in one storage call", async () => {
    const createSignedUrls = vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({
        error: null,
        path,
        signedUrl: `https://signed.example/${path}`,
        signedURL: `/object/sign/${path}`,
      })),
      error: null,
    }));
    const createSignedUrl = vi.fn();
    const db = {
      storage: {
        from: () => ({ createSignedUrls, createSignedUrl }),
      },
    } as unknown as Db;
    const urls = await storage.signedObjectUrls(
      db,
      "previews",
      ["order/preview-v1.pdf", "order/preview-v1.pdf", "order/report-v1.pdf"],
      60,
    );
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(["order/preview-v1.pdf", "order/report-v1.pdf"], 60);
    expect(urls.get("order/report-v1.pdf")).toBe("https://signed.example/order/report-v1.pdf");
  });
});
