"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { getFlowClient } from "@/lib/flow/client";
import { toPreviewOrder } from "@/lib/flow/present";
import type { CustomerOrder } from "@/lib/orders/view";
import type { PreviewOrder } from "@/components/preview/preview-order";
import { PreviewShell } from "@/components/preview/preview-shell";

const SideBySideViewer = dynamic(
  () => import("@/components/preview/side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  {
    ssr: false,
    loading: () => <PreviewShell layout="embedded" status="Loading preview…" />,
  },
);

/** Watermarked side-by-side, without buy or correction controls. */
export function PaidPreview({ token, order }: { token: string; order: CustomerOrder }) {
  const [loadedToken, setLoadedToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loadedToken === token) return;
    let cancelled = false;
    void getFlowClient()
      .preview(token)
      .then((next) => {
        if (cancelled) return;
        setError(null);
        setPreview(toPreviewOrder(order, next));
        setLoadedToken(token);
      })
      .catch(() => {
        if (!cancelled) {
          setError("The watermarked preview will show here when it is available.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, order, loadedToken]);

  if (preview) return <SideBySideViewer order={preview} chrome="readonly" />;
  if (error) return <PreviewShell layout="embedded" status={error} />;
  return <PreviewShell layout="embedded" status="Loading preview…" />;
}
