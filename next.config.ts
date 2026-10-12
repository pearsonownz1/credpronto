import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
