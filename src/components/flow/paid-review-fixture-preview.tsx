"use client";

import dynamic from "next/dynamic";
import type { PreviewOrder } from "@/components/preview/preview-order";
import { PreviewShell } from "@/components/preview/preview-shell";

const SideBySideViewer = dynamic(
  () => import("@/components/preview/side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  {
    ssr: false,
    loading: () => <PreviewShell layout="embedded" status="Loading preview…" />,
  },
);

/** Read-only sample preview. The files are public samples, not an order lookup. */
export function PaidReviewFixturePreview({ order }: { order: PreviewOrder }) {
  return <SideBySideViewer order={order} chrome="readonly" shellLayout="embedded" />;
}
