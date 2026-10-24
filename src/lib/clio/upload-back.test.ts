import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "@/lib/orders/storage";
import type { Db } from "@/lib/orders/storage";
import type { OrderRecord } from "@/lib/orders/types";
import type { ClioFetch } from "./api";
import { createMemoryClioStore } from "./memory-store";
import type { ClioConnectionRecord, ClioMatterOrderRecord } from "./types";
import { HttpError } from "@/lib/orders/errors";
import { uploadLinkedTranslation } from "./upload-back";

const pdf = new Uint8Array([9, 9, 9]);
const putUrl = "https://uploads.example/object?X-Amz-Signature=secret-signature";
const db = {} as Db;

const savedEnv = {
  id: process.env.CLIO_CLIENT_ID,
  secret: process.env.CLIO_CLIENT_SECRET,
};

function restoreEnv() {
  if (savedEnv.id === undefined) delete process.env.CLIO_CLIENT_ID;
  else process.env.CLIO_CLIENT_ID = savedEnv.id;
  if (savedEnv.secret === undefined) delete process.env.CLIO_CLIENT_SECRET;
  else process.env.CLIO_CLIENT_SECRET = savedEnv.secret;
}

const connection: ClioConnectionRecord = {
  userId: "11111111-1111-4111-8111-111111111111",
  region: "us",
  clioUserId: "555",
  clioAccountId: "42",
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
  accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  customActionId: "77",
};

function link(patch: Partial<ClioMatterOrderRecord> = {}): ClioMatterOrderRecord {
  return {
    orderId: "order-1",
    userId: connection.userId,
    region: "us",
    matterId: "123",
    documentIds: ["1"],
    uploadStatus: "pending",
    uploadError: null,
    clioDocumentId: null,
    uploadedAt: null,
    ...patch,
  };
}

function translationOrder(patch: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    orderType: "translation",
    serviceType: "translation",
    service: null,
    services: ["translation"],
    includeTranslation: false,
    finalTranslationPath: "finals/certified.pdf",
    certificationPath: "finals/cert.pdf",
    status: "approved",
    ...patch,
  } as OrderRecord;
}

type Call = { url: string; init?: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function uploadFetch(putStatus: () => number) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    if (init?.method === "PUT") return new Response(null, { status: putStatus() });
    if (init?.method === "PATCH") return jsonResponse(200, { data: { id: 88 } });
    return jsonResponse(201, {
      data: {
        id: 88,
        latest_document_version: {
          uuid: "uuid-1",
          put_url: putUrl,
          put_headers: [
            { name: "content-type", value: "application/pdf" },
            { name: "x-amz-server-side-encryption", value: "AES256" },
          ],
        },
      },
    });
  });
  return { calls, fetchImpl: fetchImpl as unknown as ClioFetch };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(storage, "downloadObject").mockResolvedValue(pdf);
  process.env.CLIO_CLIENT_ID = "test-client";
  process.env.CLIO_CLIENT_SECRET = "test-secret";
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("uploadLinkedTranslation", () => {
  it("uploads the certified PDF and marks the link uploaded", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    await store.putMatterOrder(link());
    const { calls, fetchImpl } = uploadFetch(() => 200);
    const result = await uploadLinkedTranslation(db, translationOrder(), { store, fetchImpl });
    const created = calls.find((call) => call.init?.method === "POST");
    const put = calls.find((call) => call.init?.method === "PUT");
    const patch = calls.find((call) => call.init?.method === "PATCH");
    expect(JSON.parse(String(created?.init?.body))).toEqual({
      data: { name: "certified-translation.pdf", parent: { id: 123, type: "Matter" } },
    });
    const putHeaders = new Headers(put?.init?.headers);
    expect(put?.url).toBe(putUrl);
    expect(putHeaders.get("content-type")).toBe("application/pdf");
    expect(putHeaders.get("x-amz-server-side-encryption")).toBe("AES256");
    expect(putHeaders.get("authorization")).toBeNull();
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      data: { uuid: "uuid-1", fully_uploaded: "true" },
    });
    expect(storage.downloadObject).toHaveBeenCalledWith(db, "finals", "finals/certified.pdf");
    expect(result).toEqual({ status: "uploaded", clioDocumentId: "88" });
    expect(await store.matterOrder("order-1")).toMatchObject({ uploadStatus: "uploaded", clioDocumentId: "88" });
  });

  it("records a failure without throwing or exposing the upload URL", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    await store.putMatterOrder(link());
    const { fetchImpl } = uploadFetch(() => 500);
    const result = await uploadLinkedTranslation(db, translationOrder(), { store, fetchImpl });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).not.toContain("secret-signature");
      expect(result.error).not.toContain("uploads.example");
    }
    expect((await store.matterOrder("order-1"))?.uploadStatus).toBe("failed");
  });

  it("retries a failed upload on the next call", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    await store.putMatterOrder(link());
    let putStatus = 500;
    const { fetchImpl } = uploadFetch(() => putStatus);
    const first = await uploadLinkedTranslation(db, translationOrder(), { store, fetchImpl });
    expect(first.status).toBe("failed");
    putStatus = 200;
    const second = await uploadLinkedTranslation(db, translationOrder(), { store, fetchImpl });
    expect(second).toEqual({ status: "uploaded", clioDocumentId: "88" });
  });

  it("also uploads a delivered translation", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    await store.putMatterOrder(link());
    const { fetchImpl } = uploadFetch(() => 200);
    const result = await uploadLinkedTranslation(db, translationOrder({ status: "delivered" }), { store, fetchImpl });
    expect(result).toEqual({ status: "uploaded", clioDocumentId: "88" });
  });

  it("refuses to upload before the translation is approved", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    await store.putMatterOrder(link());
    const fetchImpl = vi.fn();
    const attempt = uploadLinkedTranslation(db, translationOrder({ status: "paid" }), {
      store,
      fetchImpl: fetchImpl as unknown as ClioFetch,
    });
    await expect(attempt).rejects.toBeInstanceOf(HttpError);
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      message: "This translation is not approved yet",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storage.downloadObject).not.toHaveBeenCalled();
    expect((await store.matterOrder("order-1"))?.uploadStatus).toBe("pending");
  });

  it("does not call Clio for an evaluation order", async () => {
    const store = createMemoryClioStore();
    await store.putMatterOrder(link());
    const fetchImpl = vi.fn();
    const result = await uploadLinkedTranslation(
      db,
      translationOrder({ orderType: "evaluation", serviceType: "evaluation", service: "diploma" }),
      { store, fetchImpl: fetchImpl as unknown as ClioFetch },
    );
    expect(result).toEqual({ status: "skipped" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await store.matterOrder("order-1"))?.uploadStatus).toBe("pending");
  });

  it("does not upload again when the PDF is already in Clio", async () => {
    const store = createMemoryClioStore();
    await store.putMatterOrder(link({ uploadStatus: "uploaded", clioDocumentId: "55" }));
    const fetchImpl = vi.fn();
    const result = await uploadLinkedTranslation(db, translationOrder(), {
      store,
      fetchImpl: fetchImpl as unknown as ClioFetch,
    });
    expect(result).toEqual({ status: "uploaded", clioDocumentId: "55" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(storage.downloadObject).not.toHaveBeenCalled();
  });
});
