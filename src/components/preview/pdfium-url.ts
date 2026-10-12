"use client";

import { useEffect, useState } from "react";

export const PDFIUM_WASM_PATH = "/pdfium/pdfium.wasm";

/**
 * Absolute URL so a caller can fetch the wasm from this origin.
 * The PDFium worker is a blob and does not reuse the document preload, so the
 * page fetches this once on the main thread and hands the worker a blob URL.
 */
export function pdfiumWasmUrl(): string {
  if (typeof window === "undefined") return PDFIUM_WASM_PATH;
  return new URL(PDFIUM_WASM_PATH, window.location.origin).href;
}

let blobUrlPromise: Promise<string> | null = null;
let resolvedBlobUrl: string | null = null;

/** One network fetch for the wasm, shared across strict-mode remounts. */
export function loadPdfiumWasmBlobUrl(): Promise<string> {
  if (typeof window === "undefined") return Promise.resolve(PDFIUM_WASM_PATH);
  blobUrlPromise ??= fetchPdfiumWasmBlob();
  return blobUrlPromise;
}

async function fetchPdfiumWasmBlob(): Promise<string> {
  // credentials "same-origin" matches <link rel="preload" crossorigin="anonymous">.
  const response = await fetch(pdfiumWasmUrl(), { credentials: "same-origin", mode: "cors" });
  if (!response.ok) throw new Error(`PDFium failed to load (${response.status}).`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("PDFium download was empty.");
  const url = URL.createObjectURL(blob);
  resolvedBlobUrl = url;
  return url;
}

if (typeof window !== "undefined") void loadPdfiumWasmBlobUrl();

export function usePdfiumBlobUrl(): { url: string | null; error: Error | null } {
  const [url, setUrl] = useState<string | null>(resolvedBlobUrl);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPdfiumWasmBlobUrl().then(
      (value) => {
        if (!cancelled) setUrl(value);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error("PDFium failed to load."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return { url, error };
}
