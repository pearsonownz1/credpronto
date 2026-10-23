import { afterEach, describe, expect, it, vi } from "vitest";
import type { Verification } from "./client";
import { PdfReadError, loadPdfWithOneRetry, readPdfBlob } from "./load";

const verification: Verification = {
  status: "valid",
  type: "translation",
  issuedAt: "2026-03-04",
  documentUrl: "https://files.example/first.pdf",
  reference: "CP-10428",
};

const refreshed: Verification = {
  ...verification,
  documentUrl: "https://files.example/fresh.pdf",
};

describe("signed PDF load", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the PDF once when the fresh link works", async () => {
    const blob = new Blob(["%PDF"]);
    const verify = vi.fn();
    const readPdf = vi.fn().mockResolvedValue(blob);

    await expect(
      loadPdfWithOneRetry({ token: "tok", documentUrl: verification.documentUrl!, verification, verify, readPdf }),
    ).resolves.toEqual({ kind: "blob", blob, verification, retried: false });

    expect(verify).not.toHaveBeenCalled();
    expect(readPdf).toHaveBeenCalledTimes(1);
    expect(readPdf).toHaveBeenCalledWith("https://files.example/first.pdf", undefined);
  });

  it("refetches verification once when the link is rejected and then opens the new PDF", async () => {
    const blob = new Blob(["%PDF-fresh"]);
    const verify = vi.fn().mockResolvedValue(refreshed);
    const readPdf = vi.fn().mockRejectedValueOnce(new PdfReadError(403)).mockResolvedValueOnce(blob);

    await expect(
      loadPdfWithOneRetry({ token: "tok", documentUrl: "https://files.example/expired.pdf", verification, verify, readPdf }),
    ).resolves.toEqual({ kind: "blob", blob, verification: refreshed, retried: true });

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("tok", { signal: undefined });
    expect(readPdf).toHaveBeenNthCalledWith(2, "https://files.example/fresh.pdf", undefined);
  });

  it("does not embed a link after a second HTTP failure", async () => {
    const verify = vi.fn().mockResolvedValue(refreshed);
    const readPdf = vi.fn().mockRejectedValue(new PdfReadError(403));

    const result = await loadPdfWithOneRetry({
      token: "tok",
      documentUrl: "https://files.example/expired.pdf",
      verification,
      verify,
      readPdf,
    });

    expect(verify).toHaveBeenCalledTimes(1);
    expect(readPdf).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it("embeds the fresh link when the file itself cannot be read cross-origin", async () => {
    const verify = vi.fn().mockResolvedValue(refreshed);
    const readPdf = vi.fn().mockRejectedValue(new PdfReadError(null));

    await expect(
      loadPdfWithOneRetry({ token: "tok", documentUrl: "https://files.example/first.pdf", verification, verify, readPdf }),
    ).resolves.toEqual({ kind: "url", url: "https://files.example/fresh.pdf", verification: refreshed, retried: true });

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("stops showing a document when the fresh check is revoked or missing", async () => {
    const verify = vi.fn().mockResolvedValue({
      status: "revoked",
      type: "translation",
      issuedAt: "2026-03-04",
      documentUrl: "https://files.example/should-not-open.pdf",
      reference: "CP-10428",
    });
    const readPdf = vi.fn().mockRejectedValue(new PdfReadError(403));

    const result = await loadPdfWithOneRetry({
      token: "tok",
      documentUrl: "https://files.example/first.pdf",
      verification,
      verify,
      readPdf,
    });

    expect(result).toMatchObject({ kind: "status", verification: { status: "revoked", documentUrl: null } });
    expect(readPdf).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when the read is aborted", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    const verify = vi.fn();
    const readPdf = vi.fn().mockRejectedValue(aborted);

    await expect(
      loadPdfWithOneRetry({ token: "tok", documentUrl: "https://files.example/first.pdf", verification, verify, readPdf }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("fetches PDF bytes with no-store and without cookies", async () => {
    const blob = new Blob(["%PDF"]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(blob, { status: 200, headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readPdfBlob("https://files.example/report.pdf")).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith("https://files.example/report.pdf", {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: undefined,
    });
  });

  it("treats an error page as a failed link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () => new Response("<html>denied</html>", { status: 200, headers: { "content-type": "text/html" } }),
      ),
    );

    await expect(readPdfBlob("https://files.example/report.pdf")).rejects.toBeInstanceOf(PdfReadError);
    await expect(readPdfBlob("https://files.example/report.pdf")).rejects.toMatchObject({ httpStatus: 200 });
  });
});
