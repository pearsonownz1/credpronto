/** Public host for the free GEO Credential Services translation flow. */
export const GCS_TRANSLATE_HOST = "translate.gcs.org";

/** Fallback path on credpronto.com and preview deployments. */
export const GCS_TRANSLATE_PATH = "/gcs-translate";

/**
 * Hostname from `x-forwarded-host` (first value) or `Host`, without the port.
 * Matching is case-insensitive.
 */
export function requestHost(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-host");
  const raw = (forwarded && forwarded.trim()) || headers.get("host") || "";
  const first = raw.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.replace(/:\d+$/, "");
}

/** `translate.gcs.org` and any host that starts with that name. */
export function isGcsTranslateHost(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  return name === GCS_TRANSLATE_HOST || name.startsWith(GCS_TRANSLATE_HOST);
}

/** API routes, Next assets, images, and fonts stay on their own paths. */
export function isPreservedGcsPath(pathname: string): boolean {
  if (pathname.startsWith("/api/") || pathname === "/api") return true;
  if (pathname.startsWith("/_next/") || pathname === "/_next") return true;
  if (pathname.startsWith("/gcs/") || pathname === "/gcs") return true;
  return /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|css|js|map|txt|xml|pdf)$/i.test(pathname);
}

/**
 * Rewrite target for the GCS host. Null means the request keeps its path,
 * including `/gcs-translate` itself and every preserved asset or API route.
 */
export function gcsRewriteTarget(host: string, pathname: string): typeof GCS_TRANSLATE_PATH | null {
  if (!isGcsTranslateHost(host)) return null;
  if (isPreservedGcsPath(pathname)) return null;
  if (pathname === "/" || pathname === "/translate" || pathname === "/translate/") return GCS_TRANSLATE_PATH;
  return null;
}

/** True when this response should hide CredPronto marketing chrome. */
export function gcsFlowRequest(host: string, pathname: string): boolean {
  if (pathname === GCS_TRANSLATE_PATH || pathname.startsWith(`${GCS_TRANSLATE_PATH}/`)) return true;
  return gcsRewriteTarget(host, pathname) != null;
}
