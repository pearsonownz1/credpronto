import type { NextConfig } from "next";
import { privateCrawlHeaders } from "./src/lib/seo";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The PDFium worker is a blob, so it fetches this file cross-origin.
        source: "/pdfium/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      // Matched on the request path, so error responses stay noindex too.
      ...privateCrawlHeaders(),
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["sharp", "unpdf", "heic-convert"],
  outputFileTracingIncludes: {
    "/api/**": ["./src/lib/orders/pdf/NotoSans-Regular.ttf"],
  },
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
