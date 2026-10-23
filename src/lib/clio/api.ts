import { regionOrigin, type ClioRegion } from "./regions";

const TIMEOUT_MS = 20_000;

export type ClioFetch = typeof fetch;

export function dataObject(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as { data?: unknown }).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

export function dataArray(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

export async function clioRequest(input: {
  fetchImpl: ClioFetch;
  origin: string;
  path: string;
  token?: string;
  method?: string;
  body?: unknown;
  nonce?: string;
  search?: Record<string, string>;
}): Promise<{ status: number; json: unknown }> {
  const url = new URL(input.path, input.origin);
  if (url.origin !== input.origin) throw new Error("Clio URL was rejected");
  if (input.search) {
    for (const [key, value] of Object.entries(input.search)) url.searchParams.set(key, value);
  }
  if (input.nonce) url.searchParams.set("custom_action_nonce", input.nonce);
  const headers = new Headers();
  headers.set("accept", "application/json");
  if (input.token) headers.set("authorization", `Bearer ${input.token}`);
  if (input.body !== undefined) headers.set("content-type", "application/json");
  const response = await input.fetchImpl(url, {
    method: input.method ?? (input.body !== undefined ? "POST" : "GET"),
    headers,
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Clio request failed (${response.status})`);
  }
  const text = await response.text();
  if (!text) return { status: response.status, json: null };
  try {
    return { status: response.status, json: JSON.parse(text) as unknown };
  } catch {
    throw new Error(`Clio request failed (${response.status})`);
  }
}

export function tokenEndpoint(region: ClioRegion): string {
  return new URL("/oauth/token", regionOrigin(region)).toString();
}

export async function postToken(
  fetchImpl: ClioFetch,
  region: ClioRegion,
  body: URLSearchParams,
): Promise<{ status: number; json: unknown }> {
  const response = await fetchImpl(tokenEndpoint(region), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}
