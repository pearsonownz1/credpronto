import { describe, expect, it } from "vitest";
import { DOWNLOAD_URL_SECONDS, ORIGINALS_BUCKET } from "./constants";
import { HttpError } from "./errors";
import {
  originalDownloadResponse,
  originalTargets,
  type OriginalSource,
  type SignedOriginal,
} from "./originals";

const diploma: OriginalSource = {
  id: "doc-diploma",
  filename: "diploma.pdf",
  position: 1,
  originalPath: "order-1/doc-diploma/diploma.pdf",
};

const transcript: OriginalSource = {
  id: "doc-transcript",
  filename: "transcript.pdf",
  position: 2,
  originalPath: "order-1/doc-transcript/transcript.pdf",
};

function signed(documents: OriginalSource[]): SignedOriginal[] {
  return originalTargets(documents, null).map((target) => ({
    documentId: target.documentId,
    documentIndex: target.documentIndex,
    documentName: target.documentName,
    url: `https://files.example/${target.documentId}`,
  }));
}

describe("original download targets", () => {
  it("signs each upload key in the originals bucket, in upload order", () => {
    const targets = originalTargets([transcript, diploma], null);
    expect(targets).toEqual([
      {
        documentId: "doc-diploma",
        documentIndex: 0,
        documentName: "diploma.pdf",
        bucket: ORIGINALS_BUCKET,
        path: "order-1/doc-diploma/diploma.pdf",
      },
      {
        documentId: "doc-transcript",
        documentIndex: 1,
        documentName: "transcript.pdf",
        bucket: ORIGINALS_BUCKET,
        path: "order-1/doc-transcript/transcript.pdf",
      },
    ]);
    expect(targets.every((target) => target.bucket === "originals")).toBe(true);
    expect(JSON.stringify(targets)).not.toContain("original-combined");
  });

  it("selects one upload and keeps its index in the full order", () => {
    expect(originalTargets([diploma, transcript], " doc-transcript ").map((target) => target.path)).toEqual([
      "order-1/doc-transcript/transcript.pdf",
    ]);
    expect(originalTargets([diploma, transcript], "doc-transcript")[0]).toMatchObject({
      documentId: "doc-transcript",
      documentIndex: 1,
      documentName: "transcript.pdf",
    });
  });

  it("rejects an unknown document and an order with no uploads", () => {
    expect(() => originalTargets([diploma], "missing")).toThrowError(HttpError);
    try {
      originalTargets([diploma], "missing");
    } catch (error) {
      expect(error).toMatchObject({ status: 404, message: "Unknown document." });
    }
    try {
      originalTargets([], null);
    } catch (error) {
      expect(error).toMatchObject({ status: 404, message: "That file is not ready" });
    }
    try {
      originalTargets([{ ...diploma, originalPath: "  " }], null);
    } catch (error) {
      expect(error).toMatchObject({ status: 404, message: "That file is not ready" });
    }
  });
});

describe("original download response", () => {
  it("returns one signed url for a single upload", () => {
    expect(DOWNLOAD_URL_SECONDS).toBe(300);
    const body = originalDownloadResponse(signed([diploma]), DOWNLOAD_URL_SECONDS, null);
    expect(body).toEqual({
      url: "https://files.example/doc-diploma",
      expiresInSeconds: 300,
      documentId: "doc-diploma",
      documentIndex: 0,
      documentName: "diploma.pdf",
    });
    expect(body).not.toHaveProperty("path");
    expect(body).not.toHaveProperty("originals");
  });

  it("returns one signed url when documentId narrows a multi-document order", () => {
    const [second] = signed([diploma, transcript]).filter((file) => file.documentId === "doc-transcript");
    const body = originalDownloadResponse([second!], DOWNLOAD_URL_SECONDS, "doc-transcript");
    expect(body).toEqual({
      url: "https://files.example/doc-transcript",
      expiresInSeconds: 300,
      documentId: "doc-transcript",
      documentIndex: 1,
      documentName: "transcript.pdf",
    });
  });

  it("returns a list when several uploads are requested together", () => {
    const withSecret = signed([diploma, transcript]).map((file) => ({
      ...file,
      path: "order-1/secret.pdf",
      bucket: "finals",
    }));
    const body = originalDownloadResponse(withSecret, DOWNLOAD_URL_SECONDS, "  ");
    expect(body).toEqual({
      expiresInSeconds: 300,
      originals: [
        {
          documentId: "doc-diploma",
          documentIndex: 0,
          documentName: "diploma.pdf",
          url: "https://files.example/doc-diploma",
        },
        {
          documentId: "doc-transcript",
          documentIndex: 1,
          documentName: "transcript.pdf",
          url: "https://files.example/doc-transcript",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("finals");
    expect(body).not.toHaveProperty("url");
  });
});
