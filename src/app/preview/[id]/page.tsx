import { Suspense } from "react";
import type { Metadata } from "next";
import { LivePreview } from "@/components/preview/live-preview";
import { PreviewShell } from "@/components/preview/preview-shell";

export const metadata: Metadata = {
  title: "Preview · CredPronto",
  description: "Review your certified translation before you pay.",
};

export default function PreviewPage() {
  return (
    <Suspense fallback={<PreviewShell />}>
      <LivePreview />
    </Suspense>
  );
}
