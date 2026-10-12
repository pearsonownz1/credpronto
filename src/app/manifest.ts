import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CredPronto",
    short_name: "CredPronto",
    description:
      "Certified translations from $9.95/page. Preview yours before paying.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1F5EFF",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
