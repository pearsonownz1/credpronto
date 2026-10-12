export const PDFIUM_WASM_PATH = "/pdfium/pdfium.wasm";

/** Absolute URL so the PDFium worker (a blob) can fetch the wasm from this origin. */
export function pdfiumWasmUrl(): string {
  if (typeof window === "undefined") return PDFIUM_WASM_PATH;
  return new URL(PDFIUM_WASM_PATH, window.location.origin).href;
}
