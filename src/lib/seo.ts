export const SITE_ORIGIN = "https://www.credpronto.com";

/** Shared by the robots meta tag and the X-Robots-Tag response header. */
export const ROBOTS_NOINDEX = "noindex, nofollow";

export const HOME_CANONICAL = `${SITE_ORIGIN}/`;
export const TRANSLATE_CANONICAL = `${SITE_ORIGIN}/translate`;
export const API_DOCS_PATH = "/docs/api";
export const API_DOCS_CANONICAL = `${SITE_ORIGIN}${API_DOCS_PATH}`;
export const TRANSLATE_TITLE =
  "Certified Translation from $9.95/page, Preview Free | CredPronto";
export const TRANSLATE_DESCRIPTION =
  "Upload a PDF or phone photos for a certified translation from $9.95 per page. Preview the finished translation free before you pay.";

/** Permanent moves from the old blog URLs onto /guides. statusCode 301, not 308. */
export function blogRedirects() {
  return [
    { source: "/blog", destination: "/guides", statusCode: 301 },
    { source: "/blog/:slug", destination: "/guides/:slug", statusCode: 301 },
  ];
}

/** Permanent sign-in aliases. statusCode 301, not 308. */
export function authRedirects() {
  return [{ source: "/login", destination: "/sign-in", statusCode: 301 }];
}

/** Paths whose HTML must stay out of search indexes, including error responses. */
export function privateCrawlHeaders(): {
  source: string;
  headers: { key: string; value: string }[];
}[] {
  const header = { key: "X-Robots-Tag", value: ROBOTS_NOINDEX };
  return [
    { source: "/preview/:path*", headers: [header] },
    { source: "/order/:path*", headers: [header] },
  ];
}
