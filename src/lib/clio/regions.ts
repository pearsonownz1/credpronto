export const CLIO_REGIONS = ["us", "eu", "ca", "au"] as const;

export type ClioRegion = (typeof CLIO_REGIONS)[number];

/** Add a region by extending this map and the database check constraint. */
const REGION_ORIGINS: Record<ClioRegion, string> = {
  us: "https://app.clio.com",
  eu: "https://eu.app.clio.com",
  ca: "https://ca.app.clio.com",
  au: "https://au.app.clio.com",
};

export const CLIO_CALLBACK_PATH = "/api/integrations/clio/callback";
export const CLIO_CONNECT_PATH = "/api/integrations/clio/connect";
export const CLIO_STATUS_PATH = "/api/integrations/clio/status";
export const CLIO_DISCONNECT_PATH = "/api/integrations/clio/disconnect";
export const CLIO_ACTION_PATH = "/api/integrations/clio/actions/order-translation";
export const CLIO_TRANSLATE_PATH = "/integrations/clio/translate";

export function regionOrigin(region: ClioRegion): string {
  return REGION_ORIGINS[region];
}

export function parseClioRegion(value: string | null | undefined): ClioRegion | null {
  if (value == null || value === "" || value === "us") return "us";
  return CLIO_REGIONS.find((region) => region === value) ?? null;
}

export function isClioRegion(value: string): value is ClioRegion {
  return CLIO_REGIONS.some((region) => region === value);
}

export function assertCallbackUri(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("Clio redirect is not configured");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.pathname !== CLIO_CALLBACK_PATH || url.search !== "" || url.hash !== "") {
    throw new Error("Clio redirect is not configured");
  }
  if (url.protocol !== "https:" && !local) throw new Error("Clio redirect is not configured");
  return `${url.origin}${url.pathname}`;
}

export function authorizeUrl(input: {
  region: ClioRegion;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("/oauth/authorize", regionOrigin(input.region));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}
