import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_LOAD_ATTEMPTS,
  PREVIEW_RETRY_DELAYS_MS,
  PreviewFileNotReady,
  delayBeforePreviewAttempt,
  fetchPreviewFile,
} from "./preview-retry";

describe("delayBeforePreviewAttempt", () => {
  it("spreads four attempts across 10 seconds", () => {
    expect(PREVIEW_LOAD_ATTEMPTS).toBe(4);
    expect(delayBeforePreviewAttempt(0)).toBe(0);
    expect(delayBeforePreviewAttempt(1)).toBe(2000);
    expect(delayBeforePreviewAttempt(2)).toBe(3000);
    expect(delayBeforePreviewAttempt(3)).toBe(5000);
    expect(delayBeforePreviewAttempt(4)).toBeNull();
    expect(PREVIEW_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0)).toBe(10_000);
  });
});

describe("fetchPreviewFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a 404 as a file that is not ready yet", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPreviewFile("https://files.example/preview.pdf")).rejects.toBeInstanceOf(PreviewFileNotReady);
    expect(fetchMock).toHaveBeenCalledWith("https://files.example/preview.pdf", { cache: "no-store" });
  });

  it("treats a zero content-length as empty and cancels the body", async () => {
    const cancel = vi.fn(async () => undefined);
    const blob = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "0" }),
        body: { cancel },
        blob,
      })),
    );

    await expect(fetchPreviewFile("https://files.example/preview.pdf")).rejects.toThrow("Preview file was empty.");
    expect(cancel).toHaveBeenCalledOnce();
    expect(blob).not.toHaveBeenCalled();
  });

  it("treats a zero-byte body as empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(), { status: 200 })));

    await expect(fetchPreviewFile("https://files.example/preview.pdf")).rejects.toThrow("Preview file was empty.");
  });

  it("treats a network failure as not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(fetchPreviewFile("https://files.example/preview.pdf")).rejects.toBeInstanceOf(PreviewFileNotReady);
  });

  it("returns a non-empty file", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200, headers: { "content-length": "3" } })),
    );

    const blob = await fetchPreviewFile("https://files.example/preview.pdf");
    expect(blob.size).toBe(3);
  });
});
