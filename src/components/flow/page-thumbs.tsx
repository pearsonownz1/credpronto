"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getFlowClient } from "@/lib/flow/client";
import { openPdfDocument, renderPdfPage } from "@/lib/flow/pdf-preview";
import { resolvePreviewSource, type PreviewSource } from "@/lib/flow/preview-source";
import { uploadBlobFor } from "@/lib/flow/upload-blobs";
import { previewKind } from "./file-preview";
import type { PDFDocumentProxy } from "pdfjs-dist";

const THUMB_RENDER_WIDTH = 120;

type PageImages = {
  status: "loading" | "ready" | "missing";
  urls: string[];
};

const PageImagesContext = createContext<PageImages>({ status: "loading", urls: [] });

const thumbBox = "h-9 w-7 shrink-0 border border-line bg-bg-muted";

async function openPreviewDocument(source: PreviewSource): Promise<PDFDocumentProxy> {
  if (source.kind === "blob") {
    return openPdfDocument({ data: new Uint8Array(await source.blob.arrayBuffer()) });
  }
  return openPdfDocument({ url: source.url });
}

function usePageImages(input: {
  token: string;
  fileId: string;
  filename: string;
  sourceUrl?: string | null;
}) {
  const { token, fileId, filename, sourceUrl } = input;
  const [status, setStatus] = useState<PageImages["status"]>("loading");
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    let pdf: PDFDocumentProxy | null = null;

    async function load() {
      try {
        const source = await resolvePreviewSource({
          blob: uploadBlobFor(token, fileId, filename),
          sourceUrl,
          loadSigned: () => getFlowClient().sourceFile(token, fileId),
        });
        if (cancelled) return;
        if (!source) {
          setStatus("missing");
          return;
        }
        const kind = previewKind(filename);
        if (kind === "image") {
          const href = source.kind === "blob" ? URL.createObjectURL(source.blob) : source.url;
          if (source.kind === "blob") created.push(href);
          if (cancelled) {
            if (source.kind === "blob") URL.revokeObjectURL(href);
            return;
          }
          setUrls([href]);
          setStatus("ready");
          return;
        }
        if (kind !== "pdf") {
          setStatus("missing");
          return;
        }
        pdf = await openPreviewDocument(source);
        if (cancelled) return;
        for (let page = 1; page <= pdf.numPages; page += 1) {
          const url = await renderPdfPage(pdf, page, THUMB_RENDER_WIDTH);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          created.push(url);
          setUrls((current) => {
            const copy = current.slice();
            copy[page - 1] = url;
            return copy;
          });
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("missing");
      }
    }

    void load();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
      void pdf?.loadingTask.destroy().catch(() => undefined);
    };
  }, [token, fileId, filename, sourceUrl]);

  return { status, urls };
}

/** Loads one document for every page row. In-memory upload blob, otherwise the signed source. */
export function PageDetails({
  token,
  fileId,
  filename,
  sourceUrl,
  children,
}: {
  token: string;
  fileId: string;
  filename: string;
  sourceUrl?: string | null;
  children: ReactNode;
}) {
  const images = usePageImages({ token, fileId, filename, sourceUrl });
  return <PageImagesContext.Provider value={images}>{children}</PageImagesContext.Provider>;
}

export function PageThumb({ pageNumber }: { pageNumber: number }) {
  const images = useContext(PageImagesContext);
  const src = images.urls[pageNumber];
  if (!src) {
    const loading = images.status === "loading";
    return (
      <div
        data-testid={loading ? "page-thumb-skeleton" : "page-thumb-placeholder"}
        className={`${thumbBox} ${loading ? "animate-pulse" : ""}`}
        aria-hidden
      />
    );
  }
  return (
    <span className={`${thumbBox} overflow-hidden`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img data-testid="page-thumb" alt="" src={src} className="h-full w-full object-cover" />
    </span>
  );
}
