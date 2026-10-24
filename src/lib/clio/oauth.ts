import { randomBytes } from "node:crypto";
import { HttpError } from "@/lib/orders/errors";
import { clioRequest, postToken, type ClioFetch } from "./api";
import type { ClioCredentials } from "./config";
import { authorizeUrl, assertCallbackUri, regionOrigin, type ClioRegion } from "./regions";
import { safeClioMessage } from "./redact";
import type { ClioConnectionRecord, ClioStore } from "./types";

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;
const STATE_RE = /^[A-Za-z0-9_-]{43,128}$/;
const WHO_AM_I_SNIPPET = 120;

function clioErrorText(json: unknown): string {
  if (typeof json === "string") return json;
  if (!json || typeof json !== "object" || Array.isArray(json)) return "";
  const record = json as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") {
    const description = typeof record.error_description === "string" ? record.error_description : "";
    return description ? `${error}: ${description}` : error;
  }
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const detail = error as Record<string, unknown>;
    const type = typeof detail.type === "string" ? detail.type : "";
    const message = typeof detail.message === "string" ? detail.message : "";
    return [type, message].filter(Boolean).join(": ");
  }
  if (typeof record.message === "string") return record.message;
  return "";
}

function whoAmIFailure(status: number, json: unknown, token: string): HttpError {
  const hidden = token ? clioErrorText(json).split(token).join("[redacted]") : clioErrorText(json);
  const snippet = safeClioMessage(new Error(hidden)).slice(0, WHO_AM_I_SNIPPET);
  const message = snippet
    ? `Clio profile could not be read (${status}: ${snippet})`
    : `Clio profile could not be read (${status})`;
  const error = new HttpError(message, 502);
  console.error(safeClioMessage(error));
  return error;
}

export async function startClioConnect(input: {
  userId: string;
  region: ClioRegion;
  redirectUri: string;
  store: ClioStore;
  credentials: ClioCredentials;
  now?: number;
}): Promise<string> {
  const redirectUri = assertCallbackUri(input.redirectUri);
  const state = randomBytes(32).toString("base64url");
  const now = input.now ?? Date.now();
  await input.store.putState({
    state,
    userId: input.userId,
    region: input.region,
    redirectUri,
    expiresAt: new Date(now + STATE_TTL_MS).toISOString(),
  });
  return authorizeUrl({
    region: input.region,
    clientId: input.credentials.clientId,
    redirectUri,
    state,
  });
}

type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

function readToken(json: unknown, fallbackRefresh = ""): TokenBundle {
  if (!json || typeof json !== "object") throw new HttpError("Clio token exchange failed", 502);
  const record = json as Record<string, unknown>;
  const accessToken = typeof record.access_token === "string" ? record.access_token : "";
  const refreshToken =
    typeof record.refresh_token === "string" && record.refresh_token ? record.refresh_token : fallbackRefresh;
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : Number(record.expires_in);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new HttpError("Clio token exchange failed", 502);
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function exchangeAuthorizationCode(input: {
  fetchImpl: ClioFetch;
  region: ClioRegion;
  code: string;
  redirectUri: string;
  credentials: ClioCredentials;
}): Promise<TokenBundle> {
  const body = new URLSearchParams({
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await postToken(input.fetchImpl, input.region, body);
  if (response.status < 200 || response.status >= 300) throw new HttpError("Clio token exchange failed", 502);
  return readToken(response.json);
}

export async function refreshAccessToken(input: {
  fetchImpl: ClioFetch;
  connection: ClioConnectionRecord;
  credentials: ClioCredentials;
}): Promise<TokenBundle> {
  const body = new URLSearchParams({
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.connection.refreshToken,
  });
  const response = await postToken(input.fetchImpl, input.connection.region, body);
  if (response.status < 200 || response.status >= 300) throw new HttpError("Clio connection expired", 401);
  return readToken(response.json, input.connection.refreshToken);
}

export async function ensureFreshConnection(input: {
  fetchImpl: ClioFetch;
  store: ClioStore;
  connection: ClioConnectionRecord;
  credentials: ClioCredentials;
  now?: number;
}): Promise<ClioConnectionRecord> {
  const now = input.now ?? Date.now();
  if (Date.parse(input.connection.accessExpiresAt) - REFRESH_SKEW_MS > now) return input.connection;
  const refreshed = await refreshAccessToken(input);
  const next: ClioConnectionRecord = {
    ...input.connection,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    accessExpiresAt: refreshed.expiresAt,
  };
  await input.store.saveConnection(next);
  return next;
}

export async function clioWhoAmI(input: {
  fetchImpl: ClioFetch;
  region: ClioRegion;
  token: string;
}): Promise<{ id: string; accountId: string | null }> {
  const response = await clioRequest({
    fetchImpl: input.fetchImpl,
    origin: regionOrigin(input.region),
    path: "/api/v4/users/who_am_i",
    token: input.token,
    search: { fields: "id,account{id}" },
  });
  if (response.status < 200 || response.status >= 300) throw whoAmIFailure(response.status, response.json, input.token);
  const data =
    response.json && typeof response.json === "object" && "data" in response.json
      ? (response.json as { data?: unknown }).data
      : null;
  if (!data || typeof data !== "object") throw new HttpError("Clio profile could not be read", 502);
  const record = data as Record<string, unknown>;
  const id = typeof record.id === "number" || typeof record.id === "string" ? String(record.id) : "";
  if (!/^[0-9]+$/.test(id)) throw new HttpError("Clio profile could not be read", 502);
  const account = record.account;
  const accountId =
    account && typeof account === "object" && "id" in account && (typeof account.id === "number" || typeof account.id === "string")
      ? String(account.id)
      : null;
  return { id, accountId };
}

export type CallbackOutcome = {
  redirectTo: string;
  exchanged: boolean;
};

function dashboard(origin: string, params: Record<string, string>): string {
  const url = new URL("/dashboard/integrations", origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function completeClioOAuthCallback(input: {
  requestUrl: string;
  origin: string;
  sessionUserId: string | null;
  store: ClioStore;
  fetchImpl: ClioFetch;
  credentials: ClioCredentials;
  registerAction: (connection: ClioConnectionRecord) => Promise<string | null>;
  now?: number;
}): Promise<CallbackOutcome> {
  const now = input.now ?? Date.now();
  const url = new URL(input.requestUrl);
  const fail = (reason: string): CallbackOutcome => {
    console.error(safeClioMessage(new Error(reason)));
    return { redirectTo: dashboard(input.origin, { clio: "error" }), exchanged: false };
  };
  if (url.searchParams.get("error")) return fail("clio authorization denied");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!STATE_RE.test(state) || !code || /\s/.test(code) || code.length > 2048) return fail("clio state rejected");
  const saved = await input.store.takeState(state, now);
  if (!saved) return fail("clio state rejected");
  if (input.sessionUserId && input.sessionUserId !== saved.userId) return fail("clio state rejected");
  let redirectUri = "";
  try {
    redirectUri = assertCallbackUri(saved.redirectUri);
  } catch (error) {
    return fail(safeClioMessage(error));
  }
  try {
    const token = await exchangeAuthorizationCode({
      fetchImpl: input.fetchImpl,
      region: saved.region,
      code,
      redirectUri,
      credentials: input.credentials,
    });
    const who = await clioWhoAmI({
      fetchImpl: input.fetchImpl,
      region: saved.region,
      token: token.accessToken,
    });
    const draft: ClioConnectionRecord = {
      userId: saved.userId,
      region: saved.region,
      clioUserId: who.id,
      clioAccountId: who.accountId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      accessExpiresAt: token.expiresAt,
      customActionId: null,
    };
    const actionId = await input.registerAction(draft);
    const previous = await input.store.connectionForUser(saved.userId);
    const kept = previous && previous.region === saved.region ? previous.customActionId : null;
    await input.store.saveConnection({ ...draft, customActionId: actionId ?? kept });
    return {
      redirectTo: dashboard(input.origin, actionId ? { clio: "connected" } : { clio: "connected", clio_action: "failed" }),
      exchanged: true,
    };
  } catch (error) {
    return fail(safeClioMessage(error));
  }
}
