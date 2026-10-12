import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("loadPdfiumWasmBlobUrl", () => {
  it("fetches the wasm once and reuses the blob URL", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal("window", { location: { origin: "https://www.credpronto.com" } });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:pdfium",
    });

    const { loadPdfiumWasmBlobUrl } = await import("./pdfium-url");
    await expect(loadPdfiumWasmBlobUrl()).resolves.toBe("blob:pdfium");
    await expect(loadPdfiumWasmBlobUrl()).resolves.toBe("blob:pdfium");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://www.credpronto.com/pdfium/pdfium.wasm", {
      credentials: "same-origin",
      mode: "cors",
    });
  });

  it("rejects an empty wasm body", async () => {
    vi.stubGlobal("window", { location: { origin: "https://www.credpronto.com" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(), { status: 200 })));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:empty",
    });

    const { loadPdfiumWasmBlobUrl } = await import("./pdfium-url");
    await expect(loadPdfiumWasmBlobUrl()).rejects.toThrow("PDFium download was empty.");
  });
});
