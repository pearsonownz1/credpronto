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

export const PREVAL_PATH = "/preval";
export const PREVAL_CANONICAL = `${SITE_ORIGIN}${PREVAL_PATH}`;
export const PREVAL_TITLE = "See your likely U.S. equivalent in about a minute | CredPronto";
export const PREVAL_DESCRIPTION =
  "Upload a diploma or transcript. Our AI checks it against EDGE equivalency data and shows the likely U.S. degree, with a confidence level. No account needed.";

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
  const robots = { key: "X-Robots-Tag", value: ROBOTS_NOINDEX };
  const noStore = { key: "Cache-Control", value: "private, no-store" };
  return [
    { source: "/preview/:path*", headers: [robots] },
    { source: "/order/:path*", headers: [robots] },
    { source: "/pre-evaluation/:id", headers: [robots] },
    { source: "/verify", headers: [robots, noStore] },
    { source: "/verify/:path*", headers: [robots, noStore] },
  ];
}
