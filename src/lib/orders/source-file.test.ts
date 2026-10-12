import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/orders/[token]/files/[fileId]/source/route";
import { FINALS_BUCKET, ORIGINALS_BUCKET, SOURCE_URL_SECONDS } from "./constants";
import * as db from "./db";
import { HttpError } from "./errors";
import * as storage from "./storage";
import { getSourceFile } from "./customer";
import { sourceFileBody, sourceFileTarget } from "./source-file";
import { generateOrderToken } from "./token";
import type { DocumentRecord, OrderRecord } from "./types";

const diploma: DocumentRecord = {
  id: "file-diploma",
  orderId: "order-1",
  originalPath: "order-1/file-diploma/diploma.pdf",
  filename: "diploma.pdf",
  mime: "application/pdf",
  size: 1200,
  pageCount: 2,
  status: "ready",
  detectedLanguage: "zh",
  confidence: 1,
  position: 1,
  appliedPosition: 1,
};

const transcript: DocumentRecord = {
  id: "file-transcript",
  orderId: "order-1",
  originalPath: "order-1/file-transcript/transcript.pdf",
  filename: "transcript.pdf",
  mime: "application/pdf",
  size: 800,
  pageCount: 4,
  status: "ready",
  detectedLanguage: "zh",
  confidence: 1,
  position: 2,
  appliedPosition: 2,
};

describe("source file target", () => {
  it("signs the original upload and nothing else", () => {
    expect(SOURCE_URL_SECONDS).toBe(600);
    expect(sourceFileTarget([diploma, transcript], " file-transcript ")).toEqual({
      bucket: ORIGINALS_BUCKET,
      path: "order-1/file-transcript/transcript.pdf",
    });
    expect(sourceFileTarget([diploma], "file-diploma").bucket).toBe("originals");
    expect(sourceFileTarget([diploma], "file-diploma").bucket).not.toBe(FINALS_BUCKET);
  });

  it("returns 404 when the file is not on this order", () => {
    const missing = (fileId: string, documents: DocumentRecord[] = [diploma]) => {
      try {
        sourceFileTarget(documents, fileId);
        throw new Error("expected a 404");
      } catch (error) {
        expect(error).toMatchObject({ status: 404, message: "Not found" });
      }
    };
    missing("file-transcript");
    missing("final-translation");
    missing("  ");
    missing(diploma.id, [{ ...diploma, originalPath: "  " }]);
  });

  it("returns url and expiresAt ten minutes later", () => {
    const body = sourceFileBody("https://files.example/diploma", Date.parse("2026-10-12T10:00:00.000Z"));
    expect(body).toEqual({
      url: "https://files.example/diploma",
      expiresAt: "2026-10-12T10:10:00.000Z",
    });
    expect(Object.keys(body)).toEqual(["url", "expiresAt"]);
  });
});

describe("GET source file", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the order token and signs only that file in originals", async () => {
    const token = generateOrderToken();
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as storage.Db);
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue({ id: "order-1" } as OrderRecord);
    vi.spyOn(db, "listDocuments").mockResolvedValue([diploma, transcript]);
    const sign = vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://signed.example/diploma");

    const before = Date.now();
    const body = await getSourceFile(token, "file-diploma");
    const after = Date.now();

    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith(
      expect.anything(),
      "originals",
      "order-1/file-diploma/diploma.pdf",
      SOURCE_URL_SECONDS,
    );
    expect(sign.mock.calls[0]?.[1]).not.toBe("finals");
    expect(body.url).toBe("https://signed.example/diploma");
    expect(Object.keys(body)).toEqual(["url", "expiresAt"]);
    const expiresAt = Date.parse(body.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + SOURCE_URL_SECONDS * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + SOURCE_URL_SECONDS * 1000);

    await expect(getSourceFile(token, "other-order-file")).rejects.toMatchObject({ status: 404 });
    expect(sign).toHaveBeenCalledTimes(1);
    await expect(getSourceFile("not-a-token", "file-diploma")).rejects.toMatchObject({
      status: 404,
      message: "Order not found",
    });
    expect(sign).toHaveBeenCalledTimes(1);
  });
});

describe("source route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a private no-store response with the signed body", async () => {
    const token = generateOrderToken();
    vi.spyOn(storage, "serviceDb").mockReturnValue({} as storage.Db);
    vi.spyOn(db, "requireOrderByHash").mockResolvedValue({ id: "order-1" } as OrderRecord);
    vi.spyOn(db, "listDocuments").mockResolvedValue([diploma]);
    vi.spyOn(storage, "signedObjectUrl").mockResolvedValue("https://signed.example/diploma");

    const response = await GET(new Request("http://localhost/source"), {
      params: Promise.resolve({ token, fileId: "file-diploma" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["url", "expiresAt"]);
    expect(body.url).toBe("https://signed.example/diploma");
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const missing = await GET(new Request("http://localhost/source"), {
      params: Promise.resolve({ token, fileId: "final-translation" }),
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    await expect(missing.json()).resolves.toEqual({ error: "Not found" });
  });
});
