import type { NextConfig } from "next";

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
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["sharp", "unpdf", "heic-convert", "@embedpdf/pdfium"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./src/lib/orders/pdf/NotoSans-Regular.ttf",
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
