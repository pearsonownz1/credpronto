import { describe, expect, it, vi } from "vitest";
import { FlowApiError } from "./client";
import { resolvePreviewSource } from "./preview-source";
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
    ).resolves.toEqual({ kind: "url", url: "https://files.example/a.pdf" });
    expect(loadSigned).not.toHaveBeenCalled();
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
