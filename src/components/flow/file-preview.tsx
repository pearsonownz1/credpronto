"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getFlowClient } from "@/lib/flow/client";
import { openPdfDocument, renderPdfPage } from "@/lib/flow/pdf-preview";
import {
  resolvePreviewSource,
  SIGNED_URL_REFRESH_SKEW_MS,
  signedSourceStale,
  type PreviewSource,
} from "@/lib/flow/preview-source";
import { uploadBlobFor } from "@/lib/flow/upload-blobs";
import { pageStatusTag } from "@/lib/orders/skip-pages";
import type { PDFDocumentProxy } from "pdfjs-dist";

const RENDER_WIDTH = 960;

async function openPreviewDocument(source: PreviewSource): Promise<PDFDocumentProxy> {
  if (source.kind === "blob") {
    return openPdfDocument({ data: new Uint8Array(await source.blob.arrayBuffer()) });
  }
  return openPdfDocument({ url: source.url });
}

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
  header,
}: {
  token: string;
  fileId: string;
  filename: string;
  sourceUrl?: string | null;
  pages?: ViewerPage[];
  header: ReactNode;
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
  const [signedUntil, setSignedUntil] = useState<string | null>(null);
  if (request !== requestKey) {
    setRequest(requestKey);
    setPhase(kind === "file" ? "hidden" : "loading");
    setImageUrl(null);
    setUrls([]);
    setPageCount(0);
    setIndex(0);
    setOpen(false);
    setSignedUntil(null);
  }
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const urlsRef = useRef<string[]>([]);
  const blobs = useRef<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sourceObjectUrl = useRef<string | null>(null);
  const urlSourceRef = useRef<Extract<PreviewSource, { kind: "url" }> | null>(null);
  const imageRetries = useRef(0);

  const loadSigned = useCallback(() => getFlowClient().sourceFile(token, fileId), [token, fileId]);

  const rememberUrl = useCallback((source: PreviewSource | null) => {
    urlSourceRef.current = source?.kind === "url" ? source : null;
    setSignedUntil(source?.kind === "url" ? source.expiresAt : null);
  }, []);

  const recoverImage = useCallback(async () => {
    if (imageRetries.current >= 1) {
      setPhase("hidden");
      return;
    }
    imageRetries.current += 1;
    const failed = urlSourceRef.current;
    const source = await resolvePreviewSource({
      blob: uploadBlobFor(token, fileId, filename),
      sourceUrl,
      cached: failed ? { ...failed, expiresAt: "1970-01-01T00:00:00.000Z" } : null,
      loadSigned,
    });
    if (!source) {
      setPhase("hidden");
      return;
    }
    if (source.kind === "blob") {
      const href = URL.createObjectURL(source.blob);
      if (sourceObjectUrl.current) URL.revokeObjectURL(sourceObjectUrl.current);
      sourceObjectUrl.current = href;
      rememberUrl(null);
      setImageUrl(href);
      return;
    }
    if (failed && source.url === failed.url) {
      setPhase("hidden");
      return;
    }
    rememberUrl(source);
    setImageUrl(source.url);
  }, [token, fileId, filename, sourceUrl, loadSigned, rememberUrl]);

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
    urlSourceRef.current = null;
    imageRetries.current = 0;

    async function load() {
      const source = await resolvePreviewSource({
        blob: uploadBlobFor(token, fileId, filename),
        sourceUrl,
        cached: urlSourceRef.current,
        loadSigned,
      });
      if (cancelled) return;
      rememberUrl(source);
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
      pdf = await openPreviewDocument(source);
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
      const current = docRef.current ?? pdf;
      docRef.current = null;
      void current?.loadingTask.destroy().catch(() => {});
      if (sourceObjectUrl.current) {
        URL.revokeObjectURL(sourceObjectUrl.current);
        sourceObjectUrl.current = null;
      }
      revokeTracked();
    };
  }, [token, fileId, filename, kind, sourceUrl, storePage, revokeTracked, loadSigned, rememberUrl]);

  useEffect(() => {
    if (!signedUntil || kind === "file") return;
    const at = Date.parse(signedUntil);
    if (!Number.isFinite(at)) return;
    let cancelled = false;
    const delay = Math.max(0, at - Date.now() - SIGNED_URL_REFRESH_SKEW_MS);
    const timer = window.setTimeout(() => {
      void (async () => {
        const source = await resolvePreviewSource({
          blob: uploadBlobFor(token, fileId, filename),
          sourceUrl,
          cached: urlSourceRef.current,
          loadSigned,
        });
        if (cancelled || !source || source.kind !== "url") return;
        const previousUrl = urlSourceRef.current?.url;
        if (kind === "image") {
          rememberUrl(source);
          if (source.url !== previousUrl) setImageUrl(source.url);
          return;
        }
        if (source.url === previousUrl) {
          rememberUrl(source);
          return;
        }
        try {
          const pdf = await openPdfDocument({ url: source.url });
          if (cancelled) {
            await pdf.loadingTask.destroy();
            return;
          }
          const previous = docRef.current;
          docRef.current = pdf;
          setPageCount(pdf.numPages);
          rememberUrl(source);
          if (previous && previous !== pdf) void previous.loadingTask.destroy().catch(() => {});
        } catch {
          // Pages already painted stay on screen.
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [signedUntil, kind, token, fileId, filename, sourceUrl, loadSigned, rememberUrl]);

  useEffect(() => {
    if (kind !== "pdf" || phase !== "ready" || urlsRef.current[index]) return;
    let cancelled = false;
    void (async () => {
      let pdf = docRef.current;
      const cached = urlSourceRef.current;
      if (cached?.expiresAt && signedSourceStale(cached.expiresAt)) {
        const source = await resolvePreviewSource({
          blob: uploadBlobFor(token, fileId, filename),
          sourceUrl,
          cached,
          loadSigned,
        });
        if (cancelled || !source) return;
        try {
          pdf = await openPreviewDocument(source);
        } catch {
          return;
        }
        if (cancelled) {
          await pdf.loadingTask.destroy();
          return;
        }
        const previous = docRef.current;
        docRef.current = pdf;
        rememberUrl(source.kind === "url" ? source : null);
        if (previous && previous !== pdf) void previous.loadingTask.destroy().catch(() => {});
      }
      if (!pdf || index < 0 || index >= pdf.numPages) return;
      try {
        const url = await renderPdfPage(pdf, index + 1, RENDER_WIDTH);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        storePage(index, url);
      } catch {
        // Leave the viewer on the last page that rendered.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [index, phase, kind, storePage, token, fileId, filename, sourceUrl, loadSigned, rememberUrl]);

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
      {header}
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
                  onError={() => {
                    if (kind === "image") void recoverImage();
                    else setPhase("hidden");
                  }}
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

