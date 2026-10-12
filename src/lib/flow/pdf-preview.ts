import type { PDFDocumentProxy } from "pdfjs-dist";

const PDFJS_BASE = "/pdfjs/";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Lazy-load pdf.js and point the worker at the static file Next serves from `public/pdfjs`. */
export function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function assetOptions() {
  return {
    cMapUrl: `${PDFJS_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
    wasmUrl: `${PDFJS_BASE}wasm/`,
    iccUrl: `${PDFJS_BASE}iccs/`,
    useSystemFonts: true,
  };
}

export async function openPdfDocument(
  source: { url: string } | { data: Uint8Array },
): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const options = assetOptions();
  if ("data" in source) return pdfjs.getDocument({ data: source.data, ...options }).promise;
  try {
    return await pdfjs.getDocument({ url: source.url, ...options }).promise;
  } catch (error) {
    const response = await fetch(source.url);
    if (!response.ok) throw error;
    const data = new Uint8Array(await response.arrayBuffer());
    return pdfjs.getDocument({ data, ...options }).promise;
  }
}

/** Render one page to a JPEG blob URL, sized for a CSS width of about `maxCssWidth`. */
export async function renderPdfPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  maxCssWidth: number,
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    let scale = (maxCssWidth * pixelRatio) / Math.max(base.width, 1);
    const pixels = base.width * scale * base.height * scale;
    const cap = 2_500_000;
    if (pixels > cap) scale *= Math.sqrt(cap / pixels);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not render this page");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.86);
    });
    if (!blob) throw new Error("Could not render this page");
    return URL.createObjectURL(blob);
  } finally {
    page.cleanup();
  }
}
