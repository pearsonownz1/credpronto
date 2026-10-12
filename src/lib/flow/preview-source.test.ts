import { describe, expect, it, vi } from "vitest";
import { FlowApiError } from "./client";
import { resolvePreviewSource, SIGNED_URL_REFRESH_SKEW_MS, signedSourceStale } from "./preview-source";
import { rememberDocument, rememberUpload, uploadBlobFor } from "./upload-blobs";

describe("preview source", () => {
  it("uses the in-memory upload and does not ask for a signed URL", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const loadSigned = vi.fn();
    await expect(resolvePreviewSource({ blob, loadSigned })).resolves.toEqual({ kind: "blob", blob });
    expect(loadSigned).not.toHaveBeenCalled();
  });

  it("uses a URL already on the order before the signed endpoint", async () => {
    const loadSigned = vi.fn();
    await expect(
      resolvePreviewSource({ blob: null, sourceUrl: " https://files.example/a.pdf ", loadSigned }),
    ).resolves.toEqual({ kind: "url", url: "https://files.example/a.pdf", expiresAt: null });
    expect(loadSigned).not.toHaveBeenCalled();
  });

  it("uses the signed URL and keeps its expiry when the upload is gone", async () => {
    const loadSigned = vi.fn(async () => ({
      url: " https://files.example/signed.pdf ",
      expiresAt: " 2026-10-12T10:10:00.000Z ",
    }));
    await expect(resolvePreviewSource({ blob: null, loadSigned })).resolves.toEqual({
      kind: "url",
      url: "https://files.example/signed.pdf",
      expiresAt: "2026-10-12T10:10:00.000Z",
    });
  });

  it("reuses a signed URL until it is near expiry, then asks for a new one", async () => {
    const fresh = {
      kind: "url" as const,
      url: "https://files.example/first.pdf",
      expiresAt: "2026-10-12T10:10:00.000Z",
    };
    const loadSigned = vi.fn(async () => ({
      url: "https://files.example/second.pdf",
      expiresAt: "2026-10-12T10:20:00.000Z",
    }));
    const now = Date.parse("2026-10-12T10:00:00.000Z");
    await expect(resolvePreviewSource({ blob: null, cached: fresh, now, loadSigned })).resolves.toEqual(fresh);
    expect(loadSigned).not.toHaveBeenCalled();

    const nearExpiry = Date.parse(fresh.expiresAt) - SIGNED_URL_REFRESH_SKEW_MS;
    await expect(resolvePreviewSource({ blob: null, cached: fresh, now: nearExpiry, loadSigned })).resolves.toEqual({
      kind: "url",
      url: "https://files.example/second.pdf",
      expiresAt: "2026-10-12T10:20:00.000Z",
    });
    expect(signedSourceStale(fresh.expiresAt, nearExpiry)).toBe(true);
    expect(signedSourceStale("not-a-date", now)).toBe(true);
    expect(signedSourceStale(null, now)).toBe(false);
  });

  it("hides the preview when the signed endpoint is missing", async () => {
    await expect(
      resolvePreviewSource({
        blob: null,
        loadSigned: async () => {
          throw new FlowApiError("Not found", 404);
        },
      }),
    ).resolves.toBeNull();
  });

  it("keeps an upload blob by filename and a replacement by document id", () => {
    const original = new File(["a"], "notes.pdf", { type: "application/pdf" });
    const replacement = new File(["b"], "retake.pdf", { type: "application/pdf" });
    rememberUpload("token", [original]);
    expect(uploadBlobFor("token", "file", "notes.pdf")).toBe(original);
    rememberDocument("token", "file", replacement);
    expect(uploadBlobFor("token", "file", "notes.pdf")).toBe(replacement);
    expect(uploadBlobFor("other", "file", "notes.pdf")).toBeNull();
  });
});
