import type { NextConfig } from "next";
import { blogRedirects, privateCrawlHeaders } from "./src/lib/seo";

const nextConfig: NextConfig = {
  async redirects() {
    return blogRedirects();
  },
  async headers() {
    return [
      {
        // The PDFium worker is a blob, so it fetches this file cross-origin.
        source: "/pdfium/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // Matched on the request path, so error responses stay noindex too.
      ...privateCrawlHeaders(),
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["sharp", "unpdf", "heic-convert", "@embedpdf/pdfium"],
  outputFileTracingExcludes: {
    // Preview only signs stored PDFs. Keep PDFium and sharp out of this function.
    "/api/orders/[token]/preview": [
      "./node_modules/@embedpdf/pdfium/**",
      "./node_modules/sharp/**",
      "./node_modules/@img/**",
    ],
  },
  outputFileTracingIncludes: {
    "/api/**": [
      "./src/lib/orders/pdf/NotoSans-Regular.ttf",
      "./src/lib/orders/pdf/NotoSans-Italic.ttf",
      "./src/lib/orders/pdf/NotoSansSymbols2-Regular.ttf",
      "./src/lib/orders/pdf/ata-logo.png",
      "./src/lib/orders/pdf/credpronto-logo.png",
      "./src/lib/orders/pdf/signature.png",
      "./node_modules/@embedpdf/pdfium/**",
      "./node_modules/sharp/**",
      "./node_modules/@img/sharp-linux-x64/**",
      "./node_modules/@img/sharp-linuxmusl-x64/**",
      "./node_modules/@img/sharp-libvips-linux-x64/**",
      "./node_modules/@img/sharp-libvips-linuxmusl-x64/**",
    ],
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
