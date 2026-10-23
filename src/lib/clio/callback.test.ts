import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/integrations/clio/callback/route";
import type { Db } from "@/lib/orders/storage";
import type { ClioFetch } from "./api";
import { createMemoryClioStore } from "./memory-store";
import { completeClioOAuthCallback, startClioConnect } from "./oauth";
import { clioStore } from "./store";
import type { ClioConnectionRecord } from "./types";

vi.mock("@/lib/auth/session", () => ({
  optionalUser: async () => null,
}));

const credentials = { clientId: "test-client", clientSecret: "test-secret" };
const redirectUri = "https://www.credpronto.com/api/integrations/clio/callback";
const origin = "https://www.credpronto.com";
const userId = "11111111-1111-4111-8111-111111111111";

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

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.CLIO_CLIENT_ID = "test-client";
  process.env.CLIO_CLIENT_SECRET = "test-secret";
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("startClioConnect", () => {
  it("stores a user-bound state and sends the US authorize URL", async () => {
    const store = createMemoryClioStore();
    const location = await startClioConnect({
      userId,
      region: "us",
      redirectUri,
      store,
      credentials,
    });
    const url = new URL(location);
    expect(url.origin).toBe("https://app.clio.com");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    const state = url.searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThanOrEqual(43);
    const saved = await store.takeState(state, Date.now());
    expect(saved).toMatchObject({ userId, region: "us", redirectUri });
  });

  it("uses the EU host when that region is requested", async () => {
    const location = await startClioConnect({
      userId,
      region: "eu",
      redirectUri,
      store: createMemoryClioStore(),
      credentials,
    });
    expect(new URL(location).origin).toBe("https://eu.app.clio.com");
  });
});

describe("completeClioOAuthCallback", () => {
  async function readyStore() {
    const store = createMemoryClioStore();
    const location = await startClioConnect({ userId, region: "us", redirectUri, store, credentials });
    const state = new URL(location).searchParams.get("state") ?? "";
    return { store, state };
  }

  it("rejects an unknown state before calling Clio", async () => {
    const fetchImpl = vi.fn();
    const result = await completeClioOAuthCallback({
      requestUrl: `${origin}/api/integrations/clio/callback?code=auth-code&state=${"a".repeat(43)}`,
      origin,
      sessionUserId: userId,
      store: createMemoryClioStore(),
      fetchImpl: fetchImpl as unknown as ClioFetch,
      credentials,
      registerAction: async () => "77",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.exchanged).toBe(false);
    expect(result.redirectTo).toContain("clio=error");
  });

  it("rejects an expired state before calling Clio", async () => {
    const store = createMemoryClioStore();
    const location = await startClioConnect({
      userId,
      region: "us",
      redirectUri,
      store,
      credentials,
      now: Date.now() - 11 * 60 * 1000,
    });
    const state = new URL(location).searchParams.get("state") ?? "";
    const fetchImpl = vi.fn();
    const result = await completeClioOAuthCallback({
      requestUrl: `${origin}/api/integrations/clio/callback?code=auth-code&state=${state}`,
      origin,
      sessionUserId: userId,
      store,
      fetchImpl: fetchImpl as unknown as ClioFetch,
      credentials,
      registerAction: async () => "77",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.exchanged).toBe(false);
  });

  it("rejects a session that does not match the state", async () => {
    const { store, state } = await readyStore();
    const fetchImpl = vi.fn();
    const result = await completeClioOAuthCallback({
      requestUrl: `${origin}/api/integrations/clio/callback?code=auth-code&state=${state}`,
      origin,
      sessionUserId: "22222222-2222-4222-8222-222222222222",
      store,
      fetchImpl: fetchImpl as unknown as ClioFetch,
      credentials,
      registerAction: async () => "77",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.exchanged).toBe(false);
    expect(await store.connectionForUser(userId)).toBeNull();
  });

  it("exchanges the code and stores the connection", async () => {
    const { store, state } = await readyStore();
    const calls: Call[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = asUrl(input);
      calls.push({ url, init });
      if (url.pathname === "/oauth/token") {
        return jsonResponse(200, {
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          expires_in: 3600,
        });
      }
      if (url.pathname === "/api/v4/users/who_am_i") {
        return jsonResponse(200, { data: { id: 999, account: { id: 42 } } });
      }
      throw new Error(`unexpected ${url.pathname}`);
    });
    const result = await completeClioOAuthCallback({
      requestUrl: `${origin}/api/integrations/clio/callback?code=auth-code&state=${state}`,
      origin,
      sessionUserId: userId,
      store,
      fetchImpl: fetchImpl as unknown as ClioFetch,
      credentials,
      registerAction: async () => "77",
    });
    const token = calls.find((call) => call.url.pathname === "/oauth/token");
    const params = new URLSearchParams(String(token?.init?.body));
    expect(token?.url.origin).toBe("https://app.clio.com");
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth-code");
    expect(params.get("redirect_uri")).toBe(redirectUri);
    expect(params.get("client_id")).toBe("test-client");
    expect(params.get("client_secret")).toBe("test-secret");
    const connection = await store.connectionForUser(userId);
    expect(connection).toMatchObject({
      clioUserId: "999",
      clioAccountId: "42",
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      customActionId: "77",
    });
    expect(result.exchanged).toBe(true);
    expect(result.redirectTo).toContain("clio=connected");
    expect(result.redirectTo).not.toContain("clio_action=failed");
  });

  it("does not save a connection when the token endpoint fails", async () => {
    const { store, state } = await readyStore();
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }));
    const result = await completeClioOAuthCallback({
      requestUrl: `${origin}/api/integrations/clio/callback?code=auth-code&state=${state}`,
      origin,
      sessionUserId: userId,
      store,
      fetchImpl: fetchImpl as unknown as ClioFetch,
      credentials,
      registerAction: async () => "77",
    });
    expect(result.exchanged).toBe(false);
    expect(await store.connectionForUser(userId)).toBeNull();
  });

  it("keeps the connection when the custom action cannot be registered", async () => {
    const { store, state } = await readyStore();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = asUrl(input);
      if (url.pathname === "/oauth/token") {
        return jsonResponse(200, {
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          expires_in: 3600,
        });
      }
      return jsonResponse(200, { data: { id: 999, account: { id: 42 } } });
    });
    const result = await completeClioOAuthCallback({
      requestUrl: `${origin}/api/integrations/clio/callback?code=auth-code&state=${state}`,
      origin,
      sessionUserId: null,
      store,
      fetchImpl: fetchImpl as unknown as ClioFetch,
      credentials,
      registerAction: async () => null,
    });
    expect(result.exchanged).toBe(true);
    expect(result.redirectTo).toContain("clio=connected");
    expect(result.redirectTo).toContain("clio_action=failed");
    expect((await store.connectionForUser(userId))?.customActionId).toBeNull();
  });
});

describe("clioStore tokens", () => {
  it("persists ciphertext and reads the token back", async () => {
    const tables = new Map<string, Record<string, unknown>[]>();
    const db = {
      from(name: string) {
        const rows = tables.get(name) ?? [];
        tables.set(name, rows);
        return {
          upsert(row: Record<string, unknown>) {
            const index = rows.findIndex((existing) => existing.user_id === row.user_id);
            if (index >= 0) rows[index] = row;
            else rows.push(row);
            return Promise.resolve({ error: null });
          },
          select() {
            return {
              eq(column: string, value: string) {
                const matched = rows.filter((row) => row[column] === value);
                return {
                  maybeSingle: async () => ({ data: matched[0] ?? null, error: null }),
                };
              },
            };
          },
        };
      },
    };
    const store = clioStore(db as unknown as Db);
    const connection: ClioConnectionRecord = {
      userId,
      region: "us",
      clioUserId: "999",
      clioAccountId: "42",
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      customActionId: "77",
    };
    await store.saveConnection(connection);
    const stored = tables.get("clio_connections")?.[0];
    expect(String(stored?.access_token).startsWith("v1.")).toBe(true);
    expect(String(stored?.access_token)).not.toContain("access-token-value");
    expect(String(stored?.refresh_token)).not.toContain("refresh-token-value");
    expect(await store.connectionForUser(userId)).toMatchObject({
      accessToken: "access-token-value",
      refreshToken: "refresh-token-value",
    });
  });
});

describe("GET /api/integrations/clio/callback", () => {
  it("redirects to the error page when Clio is not configured", async () => {
    delete process.env.CLIO_CLIENT_ID;
    delete process.env.CLIO_CLIENT_SECRET;
    const response = await GET(
      new Request(`${origin}/api/integrations/clio/callback?code=auth-code&state=${"a".repeat(43)}`),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/dashboard/integrations?clio=error");
  });
});
