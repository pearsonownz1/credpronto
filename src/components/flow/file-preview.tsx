"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getFlowClient } from "@/lib/flow/client";
import { openPdfDocument, renderPdfPage } from "@/lib/flow/pdf-preview";
import { resolvePreviewSource } from "@/lib/flow/preview-source";
import { uploadBlobFor } from "@/lib/flow/upload-blobs";
import { pageStatusTag } from "@/lib/orders/skip-pages";
import type { PDFDocumentProxy } from "pdfjs-dist";

const RENDER_WIDTH = 960;

export type ViewerPage = {
  skip?: boolean;
  skipReason?: string | null;
  billableUnits?: number | null;
};

export function previewKind(filename: string): "pdf" | "image" | "file" {
  const name = filename.trim().toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/.test(name)) return "image";
  return "file";
}

/** A URL already on the order, when the API includes one. Otherwise the caller signs a fresh one. */
export function inlineSourceUrl(document: object | null | undefined): string | null {
  if (!document) return null;
  const record = document as Record<string, unknown>;
  for (const key of ["sourceUrl", "signedUrl", "url"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function freePageLabel(page: ViewerPage | undefined): string | null {
  if (!page?.skip) return null;
  const label = pageStatusTag(page);
  return label.startsWith("Free") ? label : null;
}

export function FilePreview({
  token,
  fileId,
  filename,
  sourceUrl,
  pages: pageMeta = [],
  renderThumb,
}: {
  token: string;
  fileId: string;
  filename: string;
  sourceUrl?: string | null;
  pages?: ViewerPage[];
  renderThumb: (thumb: ReactNode) => ReactNode;
}) {
  const kind = previewKind(filename);
  const requestKey = `${token}\n${fileId}\n${sourceUrl ?? ""}\n${kind}`;
  const [request, setRequest] = useState(requestKey);
  const [phase, setPhase] = useState<"loading" | "ready" | "hidden">(kind === "file" ? "hidden" : "loading");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  if (request !== requestKey) {
    setRequest(requestKey);
    setPhase(kind === "file" ? "hidden" : "loading");
    setImageUrl(null);
    setUrls([]);
    setPageCount(0);
    setIndex(0);
    setOpen(false);
  }
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const urlsRef = useRef<string[]>([]);
  const blobs = useRef<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sourceObjectUrl = useRef<string | null>(null);

  const revokeTracked = useCallback(() => {
    for (const url of blobs.current) URL.revokeObjectURL(url);
    blobs.current = [];
    urlsRef.current = [];
  }, []);

  const storePage = useCallback((pageIndex: number, url: string) => {
    if (urlsRef.current[pageIndex]) {
      URL.revokeObjectURL(url);
      return;
    }
    blobs.current.push(url);
    const copy = urlsRef.current.slice();
    copy[pageIndex] = url;
    urlsRef.current = copy;
    setUrls(copy);
  }, []);

  useEffect(() => {
    if (kind === "file") return;
    let cancelled = false;
    let pdf: PDFDocumentProxy | null = null;

    async function load() {
      const source = await resolvePreviewSource({
        blob: uploadBlobFor(token, fileId, filename),
        sourceUrl,
        loadSigned: () => getFlowClient().sourceFile(token, fileId),
      });
      if (cancelled) return;
      if (!source) {
        setPhase("hidden");
        return;
      }
      if (kind === "image") {
        const href = source.kind === "blob" ? URL.createObjectURL(source.blob) : source.url;
        if (source.kind === "blob") sourceObjectUrl.current = href;
        setImageUrl(href);
        return;
      }
      pdf =
        source.kind === "blob"
          ? await openPdfDocument({ data: new Uint8Array(await source.blob.arrayBuffer()) })
          : await openPdfDocument({ url: source.url });
      if (cancelled) {
        await pdf.loadingTask.destroy();
        pdf = null;
        return;
      }
      docRef.current = pdf;
      setPageCount(pdf.numPages);
      const first = await renderPdfPage(pdf, 1, RENDER_WIDTH);
      if (cancelled) {
        URL.revokeObjectURL(first);
        return;
      }
      storePage(0, first);
      setPhase("ready");
    }

    void load().catch(() => {
      if (!cancelled) setPhase("hidden");
    });

    return () => {
      cancelled = true;
      if (docRef.current === pdf) docRef.current = null;
      void pdf?.loadingTask.destroy();
      if (sourceObjectUrl.current) {
        URL.revokeObjectURL(sourceObjectUrl.current);
        sourceObjectUrl.current = null;
      }
      revokeTracked();
    };
  }, [token, fileId, filename, kind, sourceUrl, storePage, revokeTracked]);

  useEffect(() => {
    if (kind !== "pdf" || phase !== "ready" || urlsRef.current[index]) return;
    const pdf = docRef.current;
    if (!pdf || index < 0 || index >= pdf.numPages) return;
    let cancelled = false;
    void renderPdfPage(pdf, index + 1, RENDER_WIDTH)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        storePage(index, url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [index, phase, kind, storePage]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    dialogRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  const total = kind === "pdf" && pageCount > 0 ? pageCount : Math.max(pageMeta.length, 1);
  const safeIndex = Math.min(index, Math.max(total - 1, 0));
  const freeLabel = freePageLabel(pageMeta[safeIndex]);
  const currentSrc = kind === "image" ? imageUrl : (urls[safeIndex] ?? null);
  const showViewer = phase !== "hidden";

  function openFrom(button: HTMLButtonElement) {
    triggerRef.current = button;
    setOpen(true);
  }

  const thumb =
    phase === "hidden" ? null : (
      <FileThumb
        kind={kind}
        filename={filename}
        src={kind === "image" ? imageUrl : (urls[0] ?? null)}
        onOpen={openFrom}
        onReady={() => setPhase("ready")}
        onFail={() => setPhase("hidden")}
      />
    );

  const dialog =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0b1220]/60 p-4 sm:items-center"
            onClick={() => setOpen(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Preview of ${filename}`}
              tabIndex={-1}
              data-testid="file-preview"
              onClick={(event) => event.stopPropagation()}
              className="my-auto w-full max-w-[960px] rounded-[var(--cp-radius)] border border-line bg-white p-4 shadow-xl outline-none"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-semibold">{filename}</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="shrink-0 text-[13px] font-semibold text-primary"
                >
                  Close
                </button>
              </div>
              {currentSrc ? (
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    data-testid="file-preview-page"
                    alt=""
                    src={currentSrc}
                    className={`w-full border border-line object-contain ${freeLabel ? "opacity-40" : ""}`}
                  />
                  <figcaption className="mt-2 flex items-center gap-2 text-[13px] text-ink-muted">
                    <span>Page {safeIndex + 1}</span>
                    {freeLabel ? (
                      <span className="rounded-[var(--cp-radius)] border border-line bg-white px-1.5 py-0.5 text-[12px]">
                        {freeLabel}
                      </span>
                    ) : null}
                  </figcaption>
                </figure>
              ) : (
                <div data-testid="file-preview-pending" className="aspect-[8.5/11] animate-pulse bg-bg-muted" />
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {renderThumb(thumb)}
      {showViewer ? (
        <div data-testid="page-viewer" className="px-4 pb-8">
          <div
            data-testid="page-viewer-frame"
            className="relative mx-auto w-full md:w-[420px]"
          >
            <button
              type="button"
              data-testid="page-viewer-page"
              aria-label={`Open page ${safeIndex + 1}`}
              onClick={(event) => openFrom(event.currentTarget)}
              className="block w-full overflow-hidden border border-line bg-white p-0 shadow-[0_12px_28px_-12px_rgba(18,18,18,0.38)]"
            >
              {currentSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={currentSrc}
                  ref={(node) => {
                    if (kind === "image" && node?.complete && node.naturalWidth > 0) setPhase("ready");
                  }}
                  onLoad={() => {
                    if (kind === "image") setPhase("ready");
                  }}
                  onError={() => setPhase("hidden")}
                  className={`block w-full ${freeLabel ? "opacity-40" : ""}`}
                />
              ) : (
                <div
                  data-testid="page-viewer-skeleton"
                  className={`aspect-[8.5/11] animate-pulse bg-bg-muted ${freeLabel ? "opacity-40" : ""}`}
                />
              )}
            </button>
            {freeLabel ? (
              <span
                data-testid="page-viewer-status"
                className="pointer-events-none absolute top-3 left-3 rounded-[var(--cp-radius)] border border-line bg-white px-1.5 py-0.5 text-[12px] text-ink-muted"
              >
                {freeLabel}
              </span>
            ) : null}
            <ViewerArrow
              testId="page-viewer-prev"
              label="Previous page"
              disabled={safeIndex <= 0}
              className="left-2"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
            >
              <path d="M9 4.5 5.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </ViewerArrow>
            <ViewerArrow
              testId="page-viewer-next"
              label="Next page"
              disabled={safeIndex >= total - 1}
              className="right-2"
              onClick={() => setIndex((current) => Math.min(total - 1, current + 1))}
            >
              <path d="M6 4.5 9.5 8 6 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </ViewerArrow>
          </div>
          <p data-testid="page-viewer-label" className="mt-3 text-center text-[13px] text-ink-muted">
            Page {safeIndex + 1}
          </p>
        </div>
      ) : null}
      {dialog}
    </>
  );
}

function FileThumb({
  kind,
  filename,
  src,
  onOpen,
  onReady,
  onFail,
}: {
  kind: "pdf" | "image" | "file";
  filename: string;
  src: string | null;
  onOpen: (button: HTMLButtonElement) => void;
  onReady: () => void;
  onFail: () => void;
}) {
  const thumbClass = "h-24 w-[72px] shrink-0 border border-line";
  if (!src) {
    return <div data-testid="file-thumb-skeleton" className={`${thumbClass} animate-pulse bg-bg-muted`} aria-hidden />;
  }
  return (
    <button
      type="button"
      data-testid="file-thumb-button"
      aria-label={`Preview ${filename}`}
      onClick={(event) => onOpen(event.currentTarget)}
      className={`${thumbClass} overflow-hidden bg-white p-0`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid="file-thumb"
        alt=""
        src={src}
        ref={(node) => {
          if (kind === "image" && node?.complete && node.naturalWidth > 0) onReady();
        }}
        onLoad={() => {
          if (kind === "image") onReady();
        }}
        onError={onFail}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

function ViewerArrow({
  testId,
  label,
  disabled,
  className,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  disabled: boolean;
  className: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-white text-ink shadow-[0_4px_12px_-6px_rgba(18,18,18,0.45)] disabled:opacity-40 ${className}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

