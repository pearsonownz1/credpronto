import { browserJson } from "@/lib/api/browser";
import type { ApiResult } from "@/lib/api/types";

export const CLIO_STATUS_PATH = "/api/integrations/clio/status";
export const CLIO_CONNECT_PATH = "/api/integrations/clio/connect";
export const CLIO_DISCONNECT_PATH = "/api/integrations/clio/disconnect";

export const CLIO_CONNECTED_NOTICE = "Clio is connected.";
export const CLIO_ACTION_FAILED_NOTICE = "Clio is connected. The matter action could not be added.";
export const CLIO_ERROR_NOTICE = "Clio could not be connected. Try again.";
export const CLIO_STATUS_ERROR_NOTICE = "Clio status could not be loaded.";
export const CLIO_DISCONNECT_ERROR_NOTICE = "Clio could not be disconnected. Try again.";

export type ClioStatus = { connected: false } | { connected: true; region: string | null };

export type ClioNotice = { tone: "success" | "error"; message: string };

export type ClioLanding = {
  showConnected: boolean;
  notice: ClioNotice | null;
};

export type ClioConnectionState = "loading" | "connected" | "disconnected";

export function parseClioStatus(body: unknown): ClioStatus | null {
  if (!body || typeof body !== "object") return null;
  const connected = (body as { connected?: unknown }).connected;
  if (connected === false) return { connected: false };
  if (connected !== true) return null;
  const region = (body as { region?: unknown }).region;
  return {
    connected: true,
    region: typeof region === "string" && region.trim() !== "" ? region.trim() : null,
  };
}

/** Keep a short server message. Drop markup and oversized text. */
export function clioPublicError(error: string, fallback: string): string {
  const trimmed = error.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 180 || /[<>]/.test(trimmed)) return fallback;
  return trimmed;
}

function isErrorKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/-/g, "_");
  return normalized === "error" || normalized.startsWith("error_") || normalized.endsWith("_error");
}

function hasErrorParam(params: URLSearchParams): boolean {
  for (const [key, value] of params.entries()) {
    if (isErrorKey(key)) return true;
    if (value.trim().toLowerCase() === "error") return true;
  }
  return false;
}

/**
 * Read the integrations landing query.
 * `?clio=connected` is a return flag for the success notice. It is not a connection.
 * Any error query param becomes a fixed notice. The raw value is never shown.
 */
export function clioLandingFromSearch(search: string): ClioLanding {
  const params = new URLSearchParams(search);
  const clio = (params.get("clio") ?? "").trim().toLowerCase();
  const showConnected = clio === "connected";
  const actionFailed = (params.get("clio_action") ?? "").trim().toLowerCase() === "failed";
  if (hasErrorParam(params) || (clio !== "" && !showConnected) || (actionFailed && !showConnected)) {
    return { showConnected, notice: { tone: "error", message: CLIO_ERROR_NOTICE } };
  }
  if (showConnected && actionFailed) {
    return { showConnected: true, notice: { tone: "error", message: CLIO_ACTION_FAILED_NOTICE } };
  }
  if (showConnected) {
    return { showConnected: true, notice: { tone: "success", message: CLIO_CONNECTED_NOTICE } };
  }
  return { showConnected: false, notice: null };
}

/** Status has not arrived yet. The landing query never counts as connected. */
export function clioConnectionFromLanding(): ClioConnectionState {
  return "loading";
}

export type ClioUrl = {
  pathname: string;
  search: string;
  hash: string;
};

export type ClioHistory = {
  readonly state: unknown;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
};

/**
 * Remove `clio=connected` from a query string.
 * Also drops the paired `clio_action` flag so the leftover query is not read as a new error.
 * Returns null when that flag is absent. Returns "" when nothing else remains.
 */
export function clioSearchWithoutConnected(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if ((params.get("clio") ?? "").trim().toLowerCase() !== "connected") return null;
  params.delete("clio");
  params.delete("clio_action");
  const next = params.toString();
  return next ? `?${next}` : "";
}

/** Drop `?clio=connected` so a reload cannot pretend Clio is connected. */
export function stripClioConnectedParam(location: ClioUrl, history: ClioHistory): void {
  const next = clioSearchWithoutConnected(location.search);
  if (next === null) return;
  history.replaceState(history.state, "", `${location.pathname}${next}${location.hash}`);
}

let rememberedClioLanding: ClioLanding | null = null;

/**
 * Keep the return notice for this document.
 * The page removes the flag immediately, including a second effect pass in development,
 * and a reload starts clean because this memory does not survive it.
 */
export function rememberClioLanding(search: string): ClioLanding {
  const parsed = clioLandingFromSearch(search);
  if (clioSearchWithoutConnected(search) !== null) {
    rememberedClioLanding = parsed;
    return parsed;
  }
  return rememberedClioLanding ?? parsed;
}

export function resetRememberedClioLanding(): void {
  rememberedClioLanding = null;
}

/** Only a successful status response may show Connected. A failed call shows Connect and an error. */
export function clioConnectionFromStatus(
  status: ApiResult<ClioStatus>,
  landing: ClioLanding,
): { connection: "connected" | "disconnected"; notice: ClioNotice | null } {
  if (!status.ok) {
    const failure: ClioNotice = {
      tone: "error",
      message: clioPublicError(status.error, CLIO_STATUS_ERROR_NOTICE),
    };
    const keepLandingError = landing.notice?.tone === "error" && !landing.showConnected;
    return {
      connection: "disconnected",
      notice: keepLandingError ? landing.notice : failure,
    };
  }
  if (status.data.connected) return { connection: "connected", notice: landing.notice };
  return {
    connection: "disconnected",
    notice: landing.notice?.tone === "success" ? null : landing.notice,
  };
}

export function clioAfterDisconnect(
  disconnected: ApiResult<{ connected: false }>,
  refreshed: ApiResult<ClioStatus>,
): { connection: "connected" | "disconnected"; notice: ClioNotice | null } {
  if (!disconnected.ok) {
    return {
      connection: "connected",
      notice: { tone: "error", message: clioPublicError(disconnected.error, CLIO_DISCONNECT_ERROR_NOTICE) },
    };
  }
  if (!refreshed.ok) {
    return {
      connection: "disconnected",
      notice: { tone: "error", message: clioPublicError(refreshed.error, CLIO_STATUS_ERROR_NOTICE) },
    };
  }
  if (refreshed.data.connected) {
    return { connection: "connected", notice: { tone: "error", message: CLIO_DISCONNECT_ERROR_NOTICE } };
  }
  return { connection: "disconnected", notice: null };
}

export async function loadClioStatus(): Promise<ApiResult<ClioStatus>> {
  const result = await browserJson<unknown>(CLIO_STATUS_PATH);
  if (!result.ok) return result;
  const parsed = parseClioStatus(result.data);
  if (!parsed) return { ok: false, status: result.status, error: "Unexpected response" };
  return { ok: true, status: result.status, data: parsed };
}

export async function disconnectClio(): Promise<ApiResult<{ connected: false }>> {
  const result = await browserJson<unknown>(CLIO_DISCONNECT_PATH, { method: "POST" });
  if (!result.ok) return result;
  const parsed = parseClioStatus(result.data);
  if (!parsed || parsed.connected) return { ok: false, status: result.status, error: "Unexpected response" };
  return { ok: true, status: result.status, data: { connected: false } };
}
