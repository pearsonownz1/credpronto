import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
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

  it("retries an empty wasm body, then forgets the failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(), { status: 200 }));
    vi.stubGlobal("window", { location: { origin: "https://www.credpronto.com" } });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:empty",
    });

    const { loadPdfiumWasmBlobUrl } = await import("./pdfium-url");
    const first = loadPdfiumWasmBlobUrl().then(
      () => {
        throw new Error("expected the empty download to fail");
      },
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    await expect(first).resolves.toMatchObject({ message: "PDFium download was empty." });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const second = loadPdfiumWasmBlobUrl().then(
      () => {
        throw new Error("expected the empty download to fail");
      },
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    await expect(second).resolves.toMatchObject({ message: "PDFium download was empty." });
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("retries a 404 wasm response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("window", { location: { origin: "https://www.credpronto.com" } });
    vi.stubGlobal("fetch", fetchMock);

    const { loadPdfiumWasmBlobUrl } = await import("./pdfium-url");
    const failed = loadPdfiumWasmBlobUrl().then(
      () => {
        throw new Error("expected the 404 to fail");
      },
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    await expect(failed).resolves.toMatchObject({ message: "PDFium failed to load (404)." });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
