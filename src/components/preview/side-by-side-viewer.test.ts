/** @vitest-environment happy-dom */
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CERTIFICATE_PREVIEW, type PreviewOrder } from "./preview-order";

const scrollToPage = vi.hoisted(() => vi.fn());
const requestZoom = vi.hoisted(() => vi.fn());
const zoomedIds = vi.hoisted(() => ({ current: [] as string[] }));
const pageTotals = vi.hoisted(() => ({
  current: new Map<string, number>([
    ["original", 6],
    ["translation", 6],
    ["evaluation", 1],
  ]),
}));
const scrollListener = vi.hoisted(() => ({
  current: null as
    | null
    | ((event: {
        documentId: string;
        metrics: {
          currentPage: number;
          pageVisibilityMetrics: Array<{ pageNumber: number; original: { pageX: number; pageY: number } }>;
        };
      }) => void),
}));

vi.mock("@embedpdf/core", () => ({
  createPluginRegistration: () => ({}),
}));

vi.mock("@embedpdf/core/react", () => ({
  EmbedPDF: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@embedpdf/engines/react", () => ({
  usePdfiumEngine: () => ({ engine: null, isLoading: false, error: null }),
}));

vi.mock("@embedpdf/plugin-document-manager/react", () => ({
  DocumentManagerPluginPackage: {},
  DocumentContent: () => null,
}));

vi.mock("@embedpdf/plugin-interaction-manager/react", () => ({
  InteractionManagerPluginPackage: {},
}));

vi.mock("@embedpdf/plugin-render/react", () => ({
  RenderPluginPackage: {},
  RenderLayer: () => null,
}));

vi.mock("@embedpdf/plugin-scroll/react", () => ({
  ScrollPluginPackage: {},
  ScrollStrategy: { Vertical: "vertical" },
  Scroller: () => null,
  useScroll: () => ({ state: { currentPage: 1, totalPages: 2 } }),
  useScrollCapability: () => ({
    provides: {
      forDocument: (id: string) => ({
        getTotalPages: () => pageTotals.current.get(id) ?? 0,
        getMetrics: () => ({
          currentPage: 1,
          pageVisibilityMetrics: [{ pageNumber: 1, original: { pageX: 0, pageY: 0 } }],
        }),
        scrollToPage,
      }),
      onScroll: (handler: NonNullable<(typeof scrollListener)["current"]>) => {
        scrollListener.current = handler;
        return () => undefined;
      },
      onLayoutReady: () => () => undefined,
      onPageChange: () => () => undefined,
    },
  }),
}));

vi.mock("@embedpdf/plugin-thumbnail/react", () => ({
  ThumbnailPluginPackage: {},
}));

vi.mock("@embedpdf/plugin-viewport/react", () => ({
  ViewportPluginPackage: {},
  Viewport: ({ children }: { children: ReactNode }) => children,
  useViewportCapability: () => ({ provides: { isViewportMounted: () => true } }),
}));

vi.mock("@embedpdf/plugin-zoom/react", () => ({
  ZoomPluginPackage: {},
  ZoomMode: { FitWidth: "fit-width" },
  useZoom: () => ({ state: { currentZoomLevel: 1, zoomLevel: "fit-width" } }),
  useZoomCapability: () => ({
    provides: {
      forDocument: (id: string) => ({
        getState: () => ({ currentZoomLevel: 1, zoomLevel: "fit-width" }),
        requestZoom: (zoom: unknown) => {
          zoomedIds.current.push(id);
          requestZoom(zoom);
        },
        onZoomChange: () => () => undefined,
      }),
    },
  }),
}));

import { SideBySideViewer, clampedPageNumber } from "./side-by-side-viewer";

const roots: Root[] = [];

function installMatchMedia(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mobile && query.includes("max-width"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  document.body.replaceChildren();
  scrollToPage.mockReset();
  requestZoom.mockReset();
  zoomedIds.current = [];
  scrollListener.current = null;
  pageTotals.current = new Map([
    ["original", 6],
    ["translation", 6],
    ["evaluation", 1],
  ]);
  installMatchMedia(false);
});

function gcsOrder(evaluation?: PreviewOrder["evaluation"]): PreviewOrder {
  return {
    ...CERTIFICATE_PREVIEW,
    ...(evaluation ? { evaluation } : {}),
  };
}

const evaluationDocument: NonNullable<PreviewOrder["evaluation"]> = {
  url: "/samples/evaluation.pdf",
  subtitle: "Course-by-course evaluation",
  pages: [{ page: 1, widthPt: 612, heightPt: 792 }],
};

async function renderViewer(
  order: PreviewOrder,
  props: { onEvaluate?: () => void | Promise<void>; onDownloadEvaluation?: () => void } = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(SideBySideViewer, {
        order,
        chrome: "gcs",
        engine: {} as never,
        onEvaluate: props.onEvaluate,
        onDownloadEvaluation: props.onDownloadEvaluation,
      }),
    );
  });
  return host;
}

describe("clamped page numbers", () => {
  it("keeps a page inside each document", () => {
    expect(clampedPageNumber(5, 1)).toBe(1);
    expect(clampedPageNumber(0, 3)).toBe(1);
    expect(clampedPageNumber(2, 4)).toBe(2);
    expect(clampedPageNumber(3, 0)).toBeNull();
    expect(clampedPageNumber(Number.NaN, 2)).toBeNull();
  });
});

describe("GCS side-by-side viewer", () => {
  it("places Evaluate Document to the right of Download Certified Translation", async () => {
    installMatchMedia(false);
    let resolveEvaluation: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      resolveEvaluation = resolve;
    });
    const onEvaluate = vi.fn(() => pending);
    const host = await renderViewer(gcsOrder(), { onEvaluate });
    const download = host.querySelector('[data-testid="download-certified"]');
    const evaluate = host.querySelector('[data-testid="evaluate-document"]');

    expect(download?.textContent).toBe("Download Certified Translation");
    expect(evaluate?.textContent).toBe("Evaluate Document");
    expect(download && evaluate && Boolean(download.compareDocumentPosition(evaluate) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(host.querySelector('[data-testid="pane-evaluation"]')).toBeNull();

    await act(async () => {
      (evaluate as HTMLButtonElement).click();
    });
    const busy = host.querySelector('[data-testid="evaluate-document"]');
    expect(onEvaluate).toHaveBeenCalledTimes(1);
    expect(busy?.textContent).toBe("Evaluating...");
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveEvaluation();
      await pending;
    });
    expect(host.querySelector('[data-testid="evaluate-document"]')?.textContent).toBe("Evaluate Document");
  });

  it("adds the evaluation pane and clamps scroll sync to that document", async () => {
    installMatchMedia(false);
    const host = await renderViewer(gcsOrder(evaluationDocument), {
      onDownloadEvaluation: () => undefined,
    });
    const pane = host.querySelector('[data-testid="pane-evaluation"]');

    expect(pane?.getAttribute("aria-label")).toBe("Evaluation");
    expect(pane?.textContent).toContain("Course-by-course evaluation");
    expect(pane?.querySelector('[data-testid="translation-watermark"]')).toBeNull();
    expect(pane?.querySelector('[data-testid="download-evaluation"]')?.textContent).toBe("Download");
    expect(host.querySelector('[data-testid="pane-original"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="pane-translation"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="pane-translation"] [data-testid="translation-watermark"]')).toBeNull();

    await act(async () => {
      scrollListener.current?.({
        documentId: "original",
        metrics: {
          currentPage: 4,
          pageVisibilityMetrics: [{ pageNumber: 4, original: { pageX: 3, pageY: 9 } }],
        },
      });
    });

    expect(scrollToPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 4 }));
    expect(scrollToPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1 }));
    expect(scrollToPage).toHaveBeenCalledTimes(2);

    zoomedIds.current = [];
    await act(async () => {
      (host.querySelector('[data-testid="zoom-in"]') as HTMLButtonElement).click();
    });
    expect(zoomedIds.current).toEqual(["original", "translation", "evaluation"]);
  });

  it("switches the mobile viewer to the evaluation when it appears", async () => {
    installMatchMedia(true);
    const host = await renderViewer(gcsOrder(evaluationDocument));
    const toggle = host.querySelector('[data-testid="doc-toggle-evaluation"]');

    expect(toggle?.textContent).toBe("Evaluation");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-testid="pane-evaluation"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="pane-original"]')).toBeNull();
  });
});
