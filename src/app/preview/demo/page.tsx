import { Suspense } from "react";
import type { Metadata } from "next";
import { PreviewDemo } from "@/components/preview/preview-demo";
import { PreviewShell } from "@/components/preview/preview-shell";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Preview · CredPronto",
  description: "Side-by-side preview of a certified translation.",
  robots: ROBOTS_NOINDEX,
};

export default function PreviewDemoPage() {
  return (
    <Suspense fallback={<PreviewShell />}>
      <PreviewDemo />
    </Suspense>
  );
}
