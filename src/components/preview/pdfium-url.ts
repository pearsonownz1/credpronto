"use client";

import { useCallback, useEffect, useState } from "react";
import { PREVIEW_LOAD_ATTEMPTS, delayBeforePreviewAttempt, sleep } from "./preview-retry";

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

/**
 * One network fetch for the wasm, shared across strict-mode remounts.
 * A rejected fetch is not cached: the next call tries again. A 404 or an
 * empty body is retried a few times before the promise rejects.
 */
export function loadPdfiumWasmBlobUrl(): Promise<string> {
  if (typeof window === "undefined") return Promise.resolve(PDFIUM_WASM_PATH);
  if (resolvedBlobUrl) return Promise.resolve(resolvedBlobUrl);
  blobUrlPromise ??= fetchPdfiumWasmWithRetry();
  return blobUrlPromise;
}

async function fetchPdfiumWasmWithRetry(): Promise<string> {
  let last: unknown = new Error("PDFium failed to load.");
  for (let attempt = 0; attempt < PREVIEW_LOAD_ATTEMPTS; attempt += 1) {
    const delay = delayBeforePreviewAttempt(attempt);
    if (delay === null) break;
    if (delay > 0) await sleep(delay);
    try {
      return await fetchPdfiumWasmBlob();
    } catch (cause) {
      last = cause;
    }
  }
  blobUrlPromise = null;
  throw last instanceof Error ? last : new Error("PDFium failed to load.");
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

export function usePdfiumBlobUrl(): { url: string | null; error: Error | null; retry: () => void } {
  const [url, setUrl] = useState<string | null>(resolvedBlobUrl);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    if (resolvedBlobUrl) {
      setUrl(resolvedBlobUrl);
      return;
    }
    setUrl(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadPdfiumWasmBlobUrl().then(
      (value) => {
        if (!cancelled) {
          setUrl(value);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error("PDFium failed to load."));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { url, error, retry };
}
