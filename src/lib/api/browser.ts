import { errorMessage, type ApiResult } from "@/lib/api/types";

export function publicMockMode(): boolean {
  return process.env.NEXT_PUBLIC_CREDPRONTO_MOCK === "1";
}

/** Multipart upload. The browser sets the multipart boundary; do not force a JSON content type. */
export async function browserForm<T>(path: string, body: FormData): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      body,
      credentials: "include",
      headers: { accept: "application/json" },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: errorMessage(payload, response.status) };
    return { ok: true, status: response.status, data: payload as T };
  } catch {
    return { ok: false, status: 503, error: "Request failed" };
  }
}

export async function browserJson<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      credentials: init?.credentials ?? "include",
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, status: response.status, error: errorMessage(body, response.status) };
    return { ok: true, status: response.status, data: body as T };
  } catch {
    return { ok: false, status: 503, error: "Request failed" };
  }
}
