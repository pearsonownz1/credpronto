export const SITE_ORIGIN = "https://www.credpronto.com";

/** Shared by the robots meta tag and the X-Robots-Tag response header. */
export const ROBOTS_NOINDEX = "noindex, nofollow";

export const HOME_CANONICAL = `${SITE_ORIGIN}/`;
export const TRANSLATE_CANONICAL = `${SITE_ORIGIN}/translate`;
export const TRANSLATE_TITLE =
  "Certified Translation from $9.95/page, Preview Free | CredPronto";
export const TRANSLATE_DESCRIPTION =
  "Upload a PDF or phone photos for a certified translation from $9.95 per page. Preview the finished translation free before you pay.";

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
