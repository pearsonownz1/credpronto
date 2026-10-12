import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { CHECKOUT_PREVIEW_EDGE_PX } from "../checkout-preview";

const require = createRequire(import.meta.url);

type PdfiumHeap = WrappedPdfiumModule["pdfium"] & {
  HEAPU8: Uint8Array;
};

/** Render annotations, and store pixels as RGBA for sharp. */
const RENDER_FLAGS = 0x01 | 0x10;

let pdfiumReady: Promise<WrappedPdfiumModule> | null = null;

async function loadPdfium(): Promise<WrappedPdfiumModule> {
  if (!pdfiumReady) {
    pdfiumReady = (async () => {
      const { init } = await import("@embedpdf/pdfium");
      const wasmBinary = readFileSync(require.resolve("@embedpdf/pdfium/pdfium.wasm"));
      const pdfium = await init({ wasmBinary });
      pdfium.PDFiumExt_Init();
      return pdfium;
    })().catch((error: unknown) => {
      pdfiumReady = null;
      throw error;
    });
  }
  return pdfiumReady;
}

/**
 * Rasterize one PDF page to a PNG whose longer side is about 1000px.
 * Page index 0 is page 1. The caller must pass the watermarked preview, not the clean final.
 */
export async function renderPdfPagePng(bytes: Uint8Array, pageIndex = 0): Promise<Uint8Array> {
  if (bytes.byteLength === 0) throw new Error("Preview PDF is empty");
  const pdfium = await loadPdfium();
  const heap = pdfium.pdfium as PdfiumHeap;
  const filePtr = heap.wasmExports.malloc(bytes.byteLength);
  let doc = 0;
  let page = 0;
  let bitmap = 0;
  let widthPtr = 0;
  let heightPtr = 0;
  try {
    heap.HEAPU8.set(bytes, filePtr);
    doc = pdfium.FPDF_LoadMemDocument(filePtr, bytes.byteLength, "");
    if (!doc) throw new Error(`Could not open preview PDF (${pdfium.FPDF_GetLastError()})`);
    page = pdfium.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new Error("Preview PDF has no page 1");

    widthPtr = heap.wasmExports.malloc(8);
    heightPtr = heap.wasmExports.malloc(8);
    if (!pdfium.FPDF_GetPageSizeByIndex(doc, pageIndex, widthPtr, heightPtr)) {
      throw new Error("Could not read preview page size");
    }
    const widthPt = heap.getValue(widthPtr, "double");
    const heightPt = heap.getValue(heightPtr, "double");
    if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
      throw new Error("Preview page size is invalid");
    }

    const scale = CHECKOUT_PREVIEW_EDGE_PX / Math.max(widthPt, heightPt);
    const width = Math.max(1, Math.round(widthPt * scale));
    const height = Math.max(1, Math.round(heightPt * scale));
    bitmap = pdfium.FPDFBitmap_Create(width, height, 1);
    if (!bitmap) throw new Error("Could not allocate preview bitmap");
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, RENDER_FLAGS);

    const stride = pdfium.FPDFBitmap_GetStride(bitmap);
    const bufferPtr = pdfium.FPDFBitmap_GetBuffer(bitmap);
    const rgba = packRgba(heap.HEAPU8, bufferPtr, width, height, stride);
    const png = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer();
    return new Uint8Array(png);
  } finally {
    if (bitmap) pdfium.FPDFBitmap_Destroy(bitmap);
    if (page) pdfium.FPDF_ClosePage(page);
    if (doc) pdfium.FPDF_CloseDocument(doc);
    if (widthPtr) heap.wasmExports.free(widthPtr);
    if (heightPtr) heap.wasmExports.free(heightPtr);
    if (filePtr) heap.wasmExports.free(filePtr);
  }
}

function packRgba(heap: Uint8Array, ptr: number, width: number, height: number, stride: number): Uint8Array {
  const packed = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const start = ptr + y * stride;
    packed.set(heap.subarray(start, start + rowBytes), y * rowBytes);
  }
  return packed;
}
