"use client";

import dynamic from "next/dynamic";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { checkoutFailureMessage, documentIdForPage, previewShellOrder, toPreviewOrder } from "@/lib/flow/present";
import { writeToken } from "@/lib/flow/session";
import type { CustomerOrder } from "@/lib/orders/view";
import { timedDownloadLabel } from "./download-bytes";
import { usePdfiumBlobUrl } from "./pdfium-url";
import type { PreviewOrder } from "./preview-order";
import { PreviewShell } from "./preview-shell";

const viewerImport = () => import("./side-by-side-viewer").then((mod) => mod.SideBySideViewer);

const SideBySideViewer = dynamic(viewerImport, { ssr: false, loading: () => <PreviewShell /> });

function logPreviewTiming(fields: Record<string, number | string | null>) {
  console.info(JSON.stringify({ event: "preview_timing", ...fields }));
}

export function LivePreview() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const token = params.id ?? "";
  const canceled = search.get("canceled") === "1";
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [preview, setPreview] = useState<PreviewOrder | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(0);
  const wasm = usePdfiumBlobUrl();

  useEffect(() => {
    started.current = performance.now();
    void viewerImport();
  }, []);

  useEffect(() => {
    if (!token) return;
    writeToken(token);
    let cancelled = false;
    const origin = performance.now();

    async function load() {
      const client = getFlowClient();
      const orderTask = client.getOrder(token).then(
        (value) => ({ ok: true as const, value, ms: Math.round(performance.now() - origin) }),
        (cause: unknown) => ({ ok: false as const, cause, ms: Math.round(performance.now() - origin) }),
      );
      try {
        const nextPreview = await client.preview(token);
        const previewMs = Math.round(performance.now() - origin);
        if (cancelled) return;
        logPreviewTiming({ phase: "preview_api", ms: previewMs, call: "GET /api/orders/:id/preview" });
        setPreview(previewShellOrder(token, nextPreview));
        setError(null);
        setWaiting(null);
        const orderResult = await orderTask;
        if (cancelled) return;
        logPreviewTiming({
          phase: "order_api",
          ms: orderResult.ms,
          call: "GET /api/orders/:id",
          ok: orderResult.ok ? "yes" : "no",
        });
        if (orderResult.ok) {
          setOrder(orderResult.value);
          setPreview(toPreviewOrder(orderResult.value, nextPreview));
        }
      } catch (cause) {
        if (cancelled) return;
        logPreviewTiming({
          phase: "preview_api_error",
          ms: Math.round(performance.now() - origin),
          call: "GET /api/orders/:id/preview",
        });
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

  if (wasm.error) {
    return (
      <PreviewShell
        notice={canceled ? "Payment canceled" : undefined}
        noticeTestId={canceled ? "payment-canceled" : undefined}
        status="The preview engine failed to load. Refresh to try again."
      />
    );
  }

  if (!wasm.url) {
    return (
      <PreviewShell
        notice={canceled ? "Payment canceled" : undefined}
        noticeTestId={canceled ? "payment-canceled" : undefined}
        status={error ?? "Loading preview…"}
      />
    );
  }

  return (
    <LivePreviewEngine
      wasmUrl={wasm.url}
      started={started}
      token={token}
      canceled={canceled}
      order={order}
      preview={preview}
      error={error}
    />
  );
}

function LivePreviewEngine({
  wasmUrl,
  started,
  token,
  canceled,
  order,
  preview,
  error,
}: {
  wasmUrl: string;
  started: RefObject<number>;
  token: string;
  canceled: boolean;
  order: CustomerOrder | null;
  preview: PreviewOrder | null;
  error: string | null;
}) {
  const router = useRouter();
  const engineState = usePdfiumEngine({ wasmUrl });

  useEffect(() => {
    if (!engineState.engine) return;
    logPreviewTiming({ phase: "engine", ms: Math.round(performance.now() - started.current) });
  }, [engineState.engine, started]);

  useEffect(() => {
    if (!preview || !engineState.engine) return;
    logPreviewTiming({ phase: "viewer", ms: Math.round(performance.now() - started.current) });
    const timer = window.setTimeout(() => {
      const resources = performance.getEntriesByType("resource").filter((entry): entry is PerformanceResourceTiming => {
        return entry.name.includes("pdfium.wasm") || entry.name.includes(".pdf") || entry.name.includes("/object/");
      });
      logPreviewTiming({
        phase: "downloads",
        ms: Math.round(performance.now() - started.current),
        files: resources.map((entry) => `${Math.round(entry.duration)}ms/${timedDownloadLabel(entry)}`).join(" "),
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [preview, engineState.engine, started]);

  if (engineState.error) {
    return (
      <PreviewShell
        notice={canceled ? "Payment canceled" : undefined}
        noticeTestId={canceled ? "payment-canceled" : undefined}
        status="The preview engine failed to load. Refresh to try again."
      />
    );
  }

  if (error || !preview || !engineState.engine) {
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
      engine={engineState.engine}
      notice={canceled ? "Payment canceled" : undefined}
      noticeTestId={canceled ? "payment-canceled" : undefined}
      onBuy={async (body) => {
        writeToken(token);
        try {
          const result = await getFlowClient().checkout(token, body);
          if ("url" in result && result.url) {
            window.location.assign(result.url);
            return;
          }
          if ("mode" in result && result.mode === "paid_test") {
            router.push(`/order/${encodeURIComponent(token)}?checkout=success`);
            return;
          }
          throw new Error("Checkout did not return a payment link.");
        } catch (cause) {
          if (cause instanceof FlowApiError) {
            if (cause.status === 409 && /already paid/i.test(cause.message)) {
              router.push(`/order/${encodeURIComponent(token)}?checkout=success`);
              return;
            }
            const waiting = checkoutFailureMessage(cause.status, cause.message);
            throw new Error(waiting ?? cause.message);
          }
          throw cause instanceof Error ? cause : new Error("Payment could not start.");
        }
      }}
      onCorrect={async ({ page, note }) => {
        const documentId =
          preview.original.pages.find((item) => item.page === page)?.documentId ??
          (order ? documentIdForPage(order.documents, page) : null);
        if (!documentId) {
          throw new Error("This page isn't tied to a document yet.");
        }
        await getFlowClient().correct(token, {
          documentId,
          page,
          note,
          passage: null,
        });
        router.push(`/order/${encodeURIComponent(token)}`);
      }}
    />
  );
}
