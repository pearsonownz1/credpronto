import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIGNED_PDF_TTL_SECONDS,
  VerifyRequestError,
  fetchVerification,
  parseVerification,
  safeDocumentUrl,
  verifyRequestPath,
} from "./client";

const ORDER_ID = "28492f38-1111-4111-8111-111111111111";

const validBody = {
  status: "valid",
  type: "evaluation",
  issuedAt: "2026-10-23T19:10:00.000Z",
  documentUrl: "https://files.example/report.pdf?sig=abc",
  reference: ORDER_ID,
  fullName: "Maria Ruiz",
  dateOfBirth: "1990-01-01",
  address: "1 Main Street",
  email: "maria@example.com",
};

describe("verification client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps only the public fields and the signed link on a valid document", () => {
    expect(SIGNED_PDF_TTL_SECONDS).toBe(300);
    const parsed = parseVerification(validBody);
    expect(parsed).toEqual({
      status: "valid",
      type: "evaluation",
      issuedAt: "2026-10-23T19:10:00.000Z",
      documentUrl: "https://files.example/report.pdf?sig=abc",
      reference: ORDER_ID,
    });
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      "documentUrl",
      "issuedAt",
      "reference",
      "status",
      "type",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("Maria");
    expect(JSON.stringify(parsed)).not.toContain("1990-01-01");
    expect(JSON.stringify(parsed)).not.toContain("Main Street");
    expect(JSON.stringify(parsed)).not.toContain("maria@example.com");
  });

  it("matches the revoked and not_found bodies, and never keeps a file link", () => {
    expect(
      parseVerification({
        status: "revoked",
        type: "translation",
        issuedAt: "2026-10-23T19:10:00.000Z",
        reference: ORDER_ID,
        documentUrl: "https://files.example/secret.pdf",
        fullName: "Maria Ruiz",
      }),
    ).toEqual({
      status: "revoked",
      type: "translation",
      issuedAt: "2026-10-23T19:10:00.000Z",
      documentUrl: null,
      reference: ORDER_ID,
    });
    expect(
      parseVerification({
        status: "not_found",
        type: "evaluation",
        issuedAt: "2026-10-23T19:10:00.000Z",
        documentUrl: "https://files.example/secret.pdf",
        reference: ORDER_ID,
        fullName: "Maria Ruiz",
      }),
    ).toEqual({
      status: "not_found",
      type: null,
      issuedAt: null,
      documentUrl: null,
      reference: null,
    });
  });

  it("rejects links that are not absolute http(s) URLs", () => {
    expect(safeDocumentUrl("javascript:alert(1)")).toBeNull();
    expect(safeDocumentUrl("data:application/pdf,abc")).toBeNull();
    expect(safeDocumentUrl("https://user:secret@files.example/report.pdf")).toBeNull();
    expect(safeDocumentUrl("/files/report.pdf")).toBeNull();
    expect(safeDocumentUrl("https://files.example/report.pdf")).toBe("https://files.example/report.pdf");
  });

  it("requests a fresh verification and does not send cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(validBody));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchVerification("tok en/a")).resolves.toMatchObject({
      status: "valid",
      reference: ORDER_ID,
    });

    expect(verifyRequestPath("tok en/a")).toBe("/api/verify/tok%20en%2Fa");
    expect(fetchMock).toHaveBeenCalledWith("/api/verify/tok%20en%2Fa", {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: undefined,
    });
  });

  it("reads a 200 not_found body and does not treat rate limits or a missing file as that state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "not_found" }))
      .mockResolvedValueOnce(
        Response.json({ error: "Too many requests", code: "rate_limited", retryAfterSeconds: 12 }, { status: 429 }),
      )
      .mockResolvedValueOnce(Response.json({ error: "Document is not available" }, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchVerification("missing")).resolves.toEqual({
      status: "not_found",
      type: null,
      issuedAt: null,
      documentUrl: null,
      reference: null,
    });
    await expect(fetchVerification("limited")).rejects.toMatchObject({ name: "VerifyRequestError", status: 429 });
    await expect(fetchVerification("unstored")).rejects.toMatchObject({ name: "VerifyRequestError", status: 503 });
  });

  it("fails closed when the response is an error or not a verification", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "valid", documentUrl: "https://files.example/secret.pdf" }, { status: 500 }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchVerification("tok")).rejects.toBeInstanceOf(VerifyRequestError);
    await expect(fetchVerification("tok")).rejects.toMatchObject({ status: 200 });
  });

  it("does not turn an aborted request into a failed verification", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));

    await expect(fetchVerification("tok")).rejects.toMatchObject({ name: "AbortError" });
  });
});
