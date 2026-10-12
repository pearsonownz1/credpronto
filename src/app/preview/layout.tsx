import type { Metadata } from "next";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  robots: ROBOTS_NOINDEX,
};

export default function PreviewLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {/* anonymous matches a main-thread fetch with credentials: "same-origin". The worker cannot reuse this preload. */}
      <link rel="preload" href="/pdfium/pdfium.wasm" as="fetch" crossOrigin="anonymous" />
      {children}
    </>
  );
}
