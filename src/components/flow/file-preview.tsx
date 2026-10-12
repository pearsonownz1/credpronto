"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getFlowClient } from "@/lib/flow/client";
import { openPdfDocument, renderPdfPage } from "@/lib/flow/pdf-preview";
import type { PDFDocumentProxy } from "pdfjs-dist";

const PREVIEW_PAGES = 3;
const PREVIEW_WIDTH = 680;

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

export function FilePreview({
  token,
  fileId,
  filename,
  sourceUrl,
}: {
  token: string;
  fileId: string;
  filename: string;
  sourceUrl?: string | null;
}) {
  const kind = previewKind(filename);
  const requestKey = `${token}\n${fileId}\n${sourceUrl ?? ""}\n${kind}`;
  const [request, setRequest] = useState(requestKey);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">(kind === "file" ? "error" : "loading");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [open, setOpen] = useState(false);
  if (request !== requestKey) {
    setRequest(requestKey);
    setPhase(kind === "file" ? "error" : "loading");
    setImageUrl(null);
    setPages([]);
    setPageCount(0);
    setOpen(false);
  }
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const blobs = useRef<string[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  function track(url: string) {
    blobs.current.push(url);
    return url;
  }

  function revokeTracked() {
    for (const url of blobs.current) URL.revokeObjectURL(url);
    blobs.current = [];
  }

  useEffect(() => {
    if (kind === "file") return;
    let cancelled = false;
    let pdf: PDFDocumentProxy | null = null;

    async function load() {
      const inline = sourceUrl?.trim();
      const fileUrl = inline || (await getFlowClient().sourceFile(token, fileId)).url;
      if (cancelled) return;
      if (kind === "image") {
        setImageUrl(fileUrl);
        return;
      }
      pdf = await openPdfDocument(fileUrl);
      if (cancelled) {
        await pdf.destroy();
        pdf = null;
        return;
      }
      docRef.current = pdf;
      setPageCount(pdf.numPages);
      const first = await renderPdfPage(pdf, 1, PREVIEW_WIDTH);
      if (cancelled) {
        URL.revokeObjectURL(first);
        return;
      }
      setPages([track(first)]);
      setPhase("ready");
    }

    void load().catch(() => {
      if (!cancelled) setPhase("error");
    });

    return () => {
      cancelled = true;
      if (docRef.current === pdf) docRef.current = null;
      void pdf?.destroy();
      revokeTracked();
    };
  }, [token, fileId, kind, sourceUrl]);

  useEffect(() => {
    if (!open) return;
    const pdf = docRef.current;
    let cancelled = false;
    async function more() {
      if (!pdf) return;
      const last = Math.min(PREVIEW_PAGES, pdf.numPages);
      for (let number = 2; number <= last; number += 1) {
        let nextUrl = "";
        try {
          nextUrl = await renderPdfPage(pdf, number, PREVIEW_WIDTH);
        } catch {
          return;
        }
        if (cancelled) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        const index = number - 1;
        setPages((current) => {
          if (current[index]) {
            URL.revokeObjectURL(nextUrl);
            return current;
          }
          const copy = current.slice();
          copy[index] = track(nextUrl);
          return copy;
        });
      }
    }
    void more();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
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
      button?.focus();
    };
  }, [open]);

  const thumbClass = "h-24 w-[72px] shrink-0 border border-line";

  function close() {
    setOpen(false);
  }

  const previewCount = kind === "pdf" ? Math.min(PREVIEW_PAGES, pageCount || 1) : 1;
  const slots = open ? Array.from({ length: previewCount }, (_, index) => pages[index] ?? null) : [];
  const showSkeleton = phase === "loading" && !(kind === "image" && imageUrl);

  const dialog =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0b1220]/60 p-4 sm:items-center"
            onClick={close}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Preview of ${filename}`}
              tabIndex={-1}
              data-testid="file-preview"
              onClick={(event) => event.stopPropagation()}
              className="my-auto w-full max-w-[760px] rounded-[var(--cp-radius)] border border-line bg-white p-4 shadow-xl outline-none"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-semibold">{filename}</p>
                <button type="button" onClick={close} className="shrink-0 text-[13px] font-semibold text-primary">
                  Close
                </button>
              </div>
              <div className="space-y-4">
                {slots.map((src, index) =>
                  src ? (
                    <figure key={src}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        data-testid="file-preview-page"
                        alt=""
                        src={src}
                        className="w-full border border-line object-contain"
                      />
                      {kind === "pdf" ? (
                        <figcaption className="mt-1 text-[12px] text-ink-muted">Page {index + 1}</figcaption>
                      ) : null}
                    </figure>
                  ) : (
                    <div
                      key={`pending-${index}`}
                      data-testid="file-preview-pending"
                      className="h-64 animate-pulse border border-line bg-bg-muted"
                    />
                  ),
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {showSkeleton ? (
        <div data-testid="file-thumb-skeleton" className={`${thumbClass} animate-pulse bg-bg-muted`} aria-hidden />
      ) : null}
      {phase === "error" ? (
        <div
          data-testid="file-thumb-fallback"
          className={`${thumbClass} flex items-center justify-center bg-bg-muted text-ink-muted`}
          aria-hidden
        >
          <FileIcon />
        </div>
      ) : null}
      {kind === "image" && imageUrl && phase !== "error" ? (
        <button
          ref={buttonRef}
          type="button"
          data-testid="file-thumb-button"
          aria-label={`Preview ${filename}`}
          aria-busy={phase !== "ready"}
          onClick={() => {
            if (phase === "ready") setOpen(true);
          }}
          className={`${thumbClass} relative overflow-hidden bg-bg-muted p-0`}
        >
          {phase !== "ready" ? (
            <span data-testid="file-thumb-skeleton" className="absolute inset-0 animate-pulse bg-bg-muted" />
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-testid="file-thumb"
            alt=""
            src={imageUrl}
            ref={(node) => {
              if (node?.complete && node.naturalWidth > 0) setPhase("ready");
            }}
            onLoad={() => setPhase("ready")}
            onError={() => setPhase("error")}
            className="h-full w-full object-cover"
          />
        </button>
      ) : null}
      {kind === "pdf" && phase === "ready" && pages[0] ? (
        <button
          ref={buttonRef}
          type="button"
          data-testid="file-thumb-button"
          aria-label={`Preview ${filename}`}
          onClick={() => setOpen(true)}
          className={`${thumbClass} overflow-hidden bg-white p-0`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-testid="file-thumb" alt="" src={pages[0]} className="h-full w-full object-cover" />
        </button>
      ) : null}
      {dialog}
    </>
  );
}

function FileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 3.5h7.2L19 8.2V20.5H7V3.5Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M14 3.8V8.2H18.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
