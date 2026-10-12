"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { checkoutFailureMessage, documentIdForPage, toPreviewOrder } from "@/lib/flow/present";
import { writeToken } from "@/lib/flow/session";
import type { CustomerOrder } from "@/lib/orders/view";
import type { PreviewOrder } from "./preview-order";
import { PreviewShell } from "./preview-shell";

const SideBySideViewer = dynamic(
  () => import("./side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <PreviewShell /> },
);

export function LivePreview() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const token = params.id ?? "";
  const canceled = search.get("canceled") === "1";
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [preview, setPreview] = useState<PreviewOrder | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    writeToken(token);
    let cancelled = false;

    async function load() {
      try {
        const client = getFlowClient();
        const [nextOrder, nextPreview] = await Promise.all([
          client.getOrder(token),
          client.preview(token),
        ]);
        if (cancelled) return;
        setOrder(nextOrder);
        setPreview(toPreviewOrder(nextOrder, nextPreview));
        setError(null);
        setWaiting(null);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof FlowApiError) {
          const message = checkoutFailureMessage(cause.status, cause.message);
          if (message) {
            setWaiting(message);
            setError(null);
            return;
          }
          setError(cause.message);
          return;
        }
        setError("The preview could not be loaded.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (waiting) {
    return (
      <PreviewShell
        notice={canceled ? "Payment canceled" : undefined}
        noticeTestId={canceled ? "payment-canceled" : undefined}
        status={waiting}
      />
    );
  }

  if (error || !preview || !order) {
    return (
      <PreviewShell
        notice={canceled ? "Payment canceled" : undefined}
        noticeTestId={canceled ? "payment-canceled" : undefined}
        status={error ?? "Loading preview…"}
      />
    );
  }

  return (
    <SideBySideViewer
      order={preview}
      notice={canceled ? "Payment canceled" : undefined}
      noticeTestId={canceled ? "payment-canceled" : undefined}
      onBuy={() => {
        writeToken(token);
        router.push("/checkout");
      }}
      onCorrect={async ({ page, note, documentId }) => {
        const resolved = documentId ?? documentIdForPage(order.documents, page);
        if (!resolved) {
          throw new Error("This page isn't tied to a document yet.");
        }
        await getFlowClient().correct(token, {
          documentId: resolved,
          page,
          note,
          passage: null,
        });
        router.push(`/order/${encodeURIComponent(token)}`);
      }}
    />
  );
}
