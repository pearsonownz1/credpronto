import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClioFetch } from "./api";
import { handleOrderTranslationGet, handleOrderTranslationPost, type CreatedTranslation } from "./actions";
import { createMemoryClioStore } from "./memory-store";
import type { ClioConnectionRecord, ClioDocumentRef, ClioStore } from "./types";

const origin = "https://www.credpronto.com";
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

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

function document(id: string, filename: string): Record<string, unknown> {
  return { id: Number(id), name: filename, filename, content_type: "application/pdf", size: 120 };
}

type Call = { url: URL; init?: RequestInit };

function asUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function actionUrl(params: Record<string, string>): string {
  const url = new URL("/api/integrations/clio/actions/order-translation", origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function deps(store: ClioStore, fetchImpl: ClioFetch, createOrder = vi.fn(async (): Promise<CreatedTranslation> => ({
  orderId: "order-1",
  orderToken: "tok_123",
}))) {
  return {
    origin,
    store,
    fetchImpl,
    credentials: { clientId: "test-client", clientSecret: "test-secret" },
    getEmail: async () => "ada@example.com",
    createOrder,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handleOrderTranslationGet", () => {
  it("does not call Clio when the nonce is missing", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    const fetchImpl = vi.fn();
    const result = await handleOrderTranslationGet(
      actionUrl({ user_id: "555", subject_url: "/api/v4/matters/123", custom_action_id: "77" }),
      deps(store, fetchImpl as unknown as ClioFetch),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.process).toBeNull();
    expect(result.redirectTo).toContain("error=verify");
  });

  it("does not call Clio when the subject is on another host", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    const fetchImpl = vi.fn();
    const result = await handleOrderTranslationGet(
      actionUrl({
        custom_action_nonce: "nonce-1",
        user_id: "555",
        custom_action_id: "77",
        subject_url: "https://evil.example/api/v4/matters/123",
      }),
      deps(store, fetchImpl as unknown as ClioFetch),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.redirectTo).toContain("error=verify");
  });

  it("stops after a nonce rejection and does not list documents", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = asUrl(input);
      calls.push({ url, init });
      if (url.pathname === "/api/v4/matters/123") return jsonResponse(403, { error: "forbidden" });
      throw new Error(`unexpected ${url.pathname}`);
    });
    const result = await handleOrderTranslationGet(
      actionUrl({
        custom_action_nonce: "nonce-1",
        user_id: "555",
        custom_action_id: "77",
        subject_url: "/api/v4/matters/123",
      }),
      deps(store, fetchImpl as unknown as ClioFetch),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("custom_action_nonce")).toBe("nonce-1");
    expect(result.redirectTo).toContain("error=verify");
    expect(result.process).toBeNull();
  });

  it("saves a handoff when the matter has more than one document", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = asUrl(input);
      calls.push({ url, init });
      if (url.pathname === "/api/v4/matters/123") return jsonResponse(200, { data: { id: 123 } });
      if (url.pathname === "/api/v4/documents") {
        return jsonResponse(200, { data: [document("1", "birth.pdf"), document("2", "diploma.pdf")] });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const createOrder = vi.fn();
    const result = await handleOrderTranslationGet(
      actionUrl({
        custom_action_nonce: "nonce-1",
        user_id: "555",
        custom_action_id: "77",
        subject_url: "https://app.clio.com/api/v4/matters/123",
      }),
      deps(store, fetchImpl as unknown as ClioFetch, createOrder),
    );
    const matter = calls.find((call) => call.url.pathname === "/api/v4/matters/123");
    const documents = calls.find((call) => call.url.pathname === "/api/v4/documents");
    expect(matter?.url.searchParams.get("custom_action_nonce")).toBe("nonce-1");
    expect(documents?.url.searchParams.has("custom_action_nonce")).toBe(false);
    expect(createOrder).not.toHaveBeenCalled();
    const handoffId = new URL(result.redirectTo).searchParams.get("handoff") ?? "";
    const handoff = await store.readHandoff(handoffId, Date.now());
    expect(handoff?.matterId).toBe("123");
    expect(handoff?.documents.map((row) => row.id)).toEqual(["1", "2"]);
    expect(result.process).toBeNull();
  });

  it("creates a translation order when the matter has one document", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    const seen: Call[] = [];
    const recording = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = asUrl(input);
      seen.push({ url, init });
      if (url.pathname === "/api/v4/matters/123") return jsonResponse(200, { data: { id: 123 } });
      if (url.pathname === "/api/v4/documents") return jsonResponse(200, { data: [document("1", "birth.pdf")] });
      if (url.pathname === "/api/v4/documents/1/download") {
        return new Response(null, { status: 303, headers: { location: "https://files.example/birth.pdf" } });
      }
      if (url.origin === "https://files.example") {
        return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const createOrder = vi.fn(async () => ({ orderId: "order-1", orderToken: "tok_123" }));
    const result = await handleOrderTranslationGet(
      actionUrl({
        custom_action_nonce: "nonce-1",
        user_id: "555",
        custom_action_id: "77",
        subject_url: "/api/v4/matters/123",
      }),
      deps(store, recording as unknown as ClioFetch, createOrder),
    );
    const download = seen.find((call) => call.url.pathname === "/api/v4/documents/1/download");
    const file = seen.find((call) => call.url.origin === "https://files.example");
    expect(new Headers(download?.init?.headers).get("authorization")).toContain("Bearer");
    expect(new Headers(file?.init?.headers).get("authorization")).toBeNull();
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        documentIds: ["1"],
        files: [expect.objectContaining({ bytes: pdf, filename: "birth.pdf", mime: "application/pdf" })],
      }),
    );
    expect(result.redirectTo).toBe(`${origin}/order/tok_123`);
    expect(result.process).toEqual({ orderId: "order-1", orderToken: "tok_123" });
  });
});

describe("handleOrderTranslationPost", () => {
  it("orders only the documents the user selected", async () => {
    const store = createMemoryClioStore();
    await store.saveConnection(connection);
    const documents: ClioDocumentRef[] = [
      { id: "1", name: "birth.pdf", filename: "birth.pdf", contentType: "application/pdf" },
      { id: "2", name: "diploma.pdf", filename: "diploma.pdf", contentType: "application/pdf" },
    ];
    await store.putHandoff({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      userId: connection.userId,
      region: "us",
      matterId: "123",
      documents,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = asUrl(input);
      if (url.pathname === "/api/v4/documents/2/download") {
        return new Response(null, { status: 303, headers: { location: "https://files.example/diploma.pdf" } });
      }
      if (url.origin === "https://files.example") {
        return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const createOrder = vi.fn(async () => ({ orderId: "order-2", orderToken: "tok_456" }));
    const result = await handleOrderTranslationPost(
      { handoffId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", documentIds: ["2"] },
      deps(store, fetchImpl as unknown as ClioFetch, createOrder),
    );
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ documentIds: ["2"] }));
    expect(result.redirectTo).toBe(`${origin}/order/tok_456`);
    expect(await store.readHandoff("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", Date.now())).toBeNull();
  });
});
