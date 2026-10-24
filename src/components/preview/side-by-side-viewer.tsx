"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF, useDocumentState } from "@embedpdf/core/react";
import type { PdfEngine } from "@embedpdf/models";
import {
  DocumentContent,
  DocumentManagerPluginPackage,
  useDocumentManagerCapability,
} from "@embedpdf/plugin-document-manager/react";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager/react";
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react";
import {
  Scroller,
  ScrollPluginPackage,
  ScrollStrategy,
  useScrollCapability,
} from "@embedpdf/plugin-scroll/react";
import { ThumbnailPluginPackage } from "@embedpdf/plugin-thumbnail/react";
import {
  useViewportCapability,
  Viewport,
  ViewportPluginPackage,
} from "@embedpdf/plugin-viewport/react";
import {
  useZoom,
  useZoomCapability,
  ZoomMode,
  ZoomPluginPackage,
  type ZoomLevel,
} from "@embedpdf/plugin-zoom/react";
import { useAddonPanel, type AddonPanelState, type CheckoutBody } from "./addon-panel";
import {
  CorrectionPopover,
  MobileBuyBar,
  OrderRail,
} from "./preview-chrome";
import { PreviewShell } from "./preview-shell";
import type { PreviewCorrection, PreviewOrder } from "./preview-order";
import { anchorsMatch, visibleAnchor, type ScrollAnchor } from "./scroll-anchor";
import { PdfiumEngineGate } from "./pdfium-engine-gate";
import { usePdfiumBlobUrl } from "./pdfium-url";
import { delayBeforePreviewAttempt, fetchPreviewFile, sleep } from "./preview-retry";
import { TranslationWatermark } from "./translation-watermark";

export const ORIGINAL_DOCUMENT_ID = "original";
export const TRANSLATION_DOCUMENT_ID = "translation";
export const EVALUATION_DOCUMENT_ID = "evaluation";

const MOBILE_QUERY = "(max-width: 767px)";

type Role = "original" | "translation" | "evaluation";

const DOCUMENT_ID: Record<Role, string> = {
  original: ORIGINAL_DOCUMENT_ID,
  translation: TRANSLATION_DOCUMENT_ID,
  evaluation: EVALUATION_DOCUMENT_ID,
};

/** Null when the target document has no pages yet. Otherwise keep the page inside 1..total. */
export function clampedPageNumber(pageNumber: number, totalPages: number): number | null {
  if (!Number.isFinite(pageNumber) || !Number.isFinite(totalPages) || totalPages <= 0) return null;
  const page = Math.trunc(pageNumber);
  const total = Math.trunc(totalPages);
  if (total <= 0) return null;
  if (page < 1) return 1;
  if (page > total) return total;
  return page;
}

function roleForDocument(documentId: string): Role | null {
  if (documentId === ORIGINAL_DOCUMENT_ID) return "original";
  if (documentId === TRANSLATION_DOCUMENT_ID) return "translation";
  if (documentId === EVALUATION_DOCUMENT_ID) return "evaluation";
  return null;
}

type Snapshot = ScrollAnchor & { zoom: ZoomLevel };

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return mobile;
}

export type ViewerFocus = { page: number; nonce: number };

export type PreviewChrome = "customer" | "staff" | "readonly" | "gcs";

function showsPurchaseChrome(chrome: PreviewChrome) {
  return chrome === "customer";
}

type ViewerProps = {
  order: PreviewOrder;
  chrome?: PreviewChrome;
  /** Changes when staff asks the viewer to show a QA issue page. */
  focusPage?: ViewerFocus | null;
  onBuy?: (body: CheckoutBody) => void | Promise<void>;
  onCorrect?: (input: { page: number; note: string }) => Promise<void>;
  onDownload?: () => void | Promise<void>;
  onEvaluate?: () => void | Promise<void>;
  onDownloadEvaluation?: () => void | Promise<void>;
  notice?: string;
  noticeTestId?: string;
  /** When the page already started PDFium, skip a second wasm download. */
  engine?: PdfEngine<Blob> | null;
  /** `fill` keeps the preview header inside a parent that already owns the viewport. */
  shellLayout?: "page" | "embedded" | "fill";
};

export function SideBySideViewer(props: ViewerProps) {
  if (props.engine) return <SideBySideEngine {...props} engine={props.engine} isLoading={false} error={null} />;
  return <SideBySideOwnEngine {...props} />;
}

function SideBySideOwnEngine(props: ViewerProps) {
  const wasm = usePdfiumBlobUrl();
  if (wasm.error) {
    return <SideBySideEngine {...props} engine={null} isLoading={false} error={wasm.error} onRetry={wasm.retry} />;
  }
  if (!wasm.url) return <SideBySideEngine {...props} engine={null} isLoading error={null} />;
  return <SideBySideBlobEngine {...props} wasmUrl={wasm.url} />;
}

function SideBySideBlobEngine({ wasmUrl, ...props }: ViewerProps & { wasmUrl: string }) {
  return (
    <PdfiumEngineGate
      wasmUrl={wasmUrl}
      loading={<SideBySideEngine {...props} engine={null} isLoading error={null} />}
      failed={(retry) => (
        <SideBySideEngine
          {...props}
          engine={null}
          isLoading={false}
          error={new Error("The preview engine failed to load.")}
          onRetry={retry}
        />
      )}
    >
      {(engine) => <SideBySideEngine {...props} engine={engine} isLoading={false} error={null} />}
    </PdfiumEngineGate>
  );
}

function SideBySideEngine({
  order,
  chrome = "customer",
  focusPage = null,
  onBuy,
  onCorrect,
  onDownload,
  onEvaluate,
  onDownloadEvaluation,
  notice,
  noticeTestId,
  shellLayout,
  engine,
  isLoading,
  error,
  onRetry,
}: ViewerProps & {
  engine: PdfEngine<Blob> | null;
  isLoading: boolean;
  error: Error | null;
  onRetry?: () => void;
}) {
  const panel = useAddonPanel(order, onBuy);
  const original = order.original.url;
  const translation = order.translation.url;
  const evaluation = order.evaluation?.url ?? null;
  const files = usePreviewFileRecovery(original, translation, evaluation);
  const sourceOriginal = files.urls?.original ?? original;
  const sourceTranslation = files.urls?.translation ?? translation;
  const sourceEvaluation = files.urls?.evaluation ?? evaluation;
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [
          { url: sourceOriginal, documentId: ORIGINAL_DOCUMENT_ID, name: "Original" },
          {
            url: sourceTranslation,
            documentId: TRANSLATION_DOCUMENT_ID,
            name: "Translation",
          },
        ],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage, {
        defaultStrategy: ScrollStrategy.Vertical,
        defaultPageGap: 12,
      }),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(ZoomPluginPackage, {
        defaultZoomLevel: ZoomMode.FitWidth,
      }),
      createPluginRegistration(ThumbnailPluginPackage, {
        width: 64,
        paddingY: 8,
      }),
    ],
    [sourceOriginal, sourceTranslation],
  );

  const layout = shellLayout ?? (chrome === "readonly" || chrome === "gcs" ? "embedded" : "page");
  const purchase = showsPurchaseChrome(chrome);

  if (error || files.failed) {
    return (
      <PreviewShell
        layout={layout}
        order={layout === "embedded" ? undefined : order}
        rail={purchase ? <OrderRail order={order} corrections={order.corrections} panel={panel} /> : undefined}
        notice={notice}
        noticeTestId={noticeTestId}
        status={
          error
            ? "The preview engine failed to load. Refresh to try again."
            : "This document could not be opened."
        }
        onRetry={error ? onRetry : files.retry}
      />
    );
  }

  if (isLoading || !engine || files.recovering) {
    return (
      <PreviewShell
        layout={layout}
        order={layout === "embedded" ? undefined : order}
        rail={purchase ? <OrderRail order={order} corrections={order.corrections} panel={panel} /> : undefined}
        mobileBar={purchase ? <MobileBuyBar order={order} onFlag={() => undefined} panel={panel} /> : undefined}
        notice={notice}
        noticeTestId={noticeTestId}
        status="Loading preview…"
      />
    );
  }

  return (
    <EmbedPDF
      key={`${sourceOriginal}:${sourceTranslation}`}
      engine={engine}
      plugins={plugins}
    >
      <ViewerWorkspace
        order={order}
        chrome={chrome}
        layout={layout}
        focusPage={focusPage}
        panel={panel}
        sourceEvaluation={sourceEvaluation}
        onCorrect={onCorrect}
        onDownload={onDownload}
        onEvaluate={onEvaluate}
        onDownloadEvaluation={onDownloadEvaluation}
        notice={notice}
        noticeTestId={noticeTestId}
        onDocumentError={files.recover}
      />
    </EmbedPDF>
  );
}

function usePageCount(documentId: string) {
  const { provides } = useScrollCapability();
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    if (!provides) return;

    const sync = () => {
      try {
        const scope = provides.forDocument(documentId);
        const count = scope.getTotalPages();
        const page = scope.getCurrentPage();
        if (count > 0) setTotalPages(count);
        if (page > 0) setCurrentPage(page);
      } catch {
        // The evaluation document is opened after the viewer mounts.
      }
    };

    sync();
    const timers = [100, 400, 1000].map((delay) => window.setTimeout(sync, delay));
    const stopLayout = provides.onLayoutReady((event) => {
      if (event.documentId !== documentId) return;
      if (event.totalPages > 0) setTotalPages(event.totalPages);
      if (event.pageNumber > 0) setCurrentPage(event.pageNumber);
    });
    const stopPage = provides.onPageChange((event) => {
      if (event.documentId !== documentId) return;
      if (event.totalPages > 0) setTotalPages(event.totalPages);
      if (event.pageNumber > 0) setCurrentPage(event.pageNumber);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      stopLayout();
      stopPage();
    };
  }, [documentId, provides]);

  return { currentPage, totalPages };
}

function ViewerWorkspace({
  order,
  chrome,
  layout,
  focusPage,
  panel,
  sourceEvaluation,
  onCorrect,
  onDownload,
  onEvaluate,
  onDownloadEvaluation,
  notice,
  noticeTestId,
  onDocumentError,
}: {
  order: PreviewOrder;
  chrome: PreviewChrome;
  layout: "page" | "embedded" | "fill";
  focusPage: ViewerFocus | null;
  panel: AddonPanelState;
  sourceEvaluation: string | null;
  onCorrect?: (input: { page: number; note: string }) => Promise<void>;
  onDownload?: () => void | Promise<void>;
  onEvaluate?: () => void | Promise<void>;
  onDownloadEvaluation?: () => void | Promise<void>;
  notice?: string;
  noticeTestId?: string;
  onDocumentError: () => void;
}) {
  const isMobile = useIsMobile();
  const [role, setRole] = useState<Role>("original");
  const [lead, setLead] = useState<Role>("original");
  const [syncScroll, setSyncScroll] = useState(true);
  const [corrections, setCorrections] = useState<PreviewCorrection[]>(
    order.corrections,
  );
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [flagPage, setFlagPage] = useState(1);
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const { provides: scrollCapability } = useScrollCapability();
  const { provides: zoomCapability } = useZoomCapability();
  const { provides: viewportCapability } = useViewportCapability();
  const { provides: documentManager } = useDocumentManagerCapability();
  const originalScroll = usePageCount(ORIGINAL_DOCUMENT_ID);
  const translationScroll = usePageCount(TRANSLATION_DOCUMENT_ID);
  const evaluationScroll = usePageCount(EVALUATION_DOCUMENT_ID);
  const leadScroll =
    lead === "translation" ? translationScroll : lead === "evaluation" ? evaluationScroll : originalScroll;
  const { state: leadZoom } = useZoom(DOCUMENT_ID[lead]);
  const snapshot = useRef<Snapshot>({
    pageNumber: 1,
    x: 0,
    y: 0,
    zoom: ZoomMode.FitWidth,
  });
  const pendingRestore = useRef<Role | null>(null);
  const syncScrollRef = useRef(syncScroll);
  const suppressSync = useRef(false);
  const leadRef = useRef(lead);
  const hasEvaluation = Boolean(order.evaluation);
  const activeDocumentIds = useMemo(
    () =>
      hasEvaluation
        ? [ORIGINAL_DOCUMENT_ID, TRANSLATION_DOCUMENT_ID, EVALUATION_DOCUMENT_ID]
        : [ORIGINAL_DOCUMENT_ID, TRANSLATION_DOCUMENT_ID],
    [hasEvaluation],
  );
  const seenEvaluationUrl = useRef<string | null>(null);
  const openedEvaluationUrl = useRef<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  useEffect(() => {
    if (!documentManager || !sourceEvaluation) return;
    if (openedEvaluationUrl.current === sourceEvaluation) return;
    openedEvaluationUrl.current = sourceEvaluation;
    const task = documentManager.openDocumentUrl({
      url: sourceEvaluation,
      documentId: EVALUATION_DOCUMENT_ID,
      name: "Evaluation",
      autoActivate: false,
    });
    const fail = () => {
      if (openedEvaluationUrl.current === sourceEvaluation) openedEvaluationUrl.current = null;
      onDocumentError();
    };
    task.wait(
      (response) => {
        response.task.wait(() => undefined, fail);
      },
      fail,
    );
  }, [documentManager, onDocumentError, sourceEvaluation]);

  useEffect(() => {
    syncScrollRef.current = syncScroll;
    leadRef.current = lead;
  }, [lead, syncScroll]);

  useEffect(() => {
    const url = order.evaluation?.url;
    if (!isMobile || !url || seenEvaluationUrl.current === url) return;
    seenEvaluationUrl.current = url;
    pendingRestore.current = "evaluation";
    leadRef.current = "evaluation";
    setLead("evaluation");
    setRole("evaluation");
  }, [isMobile, order.evaluation?.url]);

  useEffect(() => {
    if (!scrollCapability) return;

    return scrollCapability.onScroll((event) => {
      const sourceRole = roleForDocument(event.documentId);
      if (!sourceRole || !activeDocumentIds.includes(event.documentId)) return;

      if (pendingRestore.current) return;

      const sourceAnchor = visibleAnchor(event.metrics);
      snapshot.current = { ...snapshot.current, ...sourceAnchor };

      if (leadRef.current !== sourceRole && !suppressSync.current) {
        leadRef.current = sourceRole;
        setLead(sourceRole);
      }

      if (suppressSync.current || !syncScrollRef.current) return;

      let synced = false;
      for (const targetId of activeDocumentIds) {
        if (targetId === event.documentId) continue;
        try {
          const target = scrollCapability.forDocument(targetId);
          const pageNumber = clampedPageNumber(sourceAnchor.pageNumber, target.getTotalPages());
          if (pageNumber == null) continue;
          const clamped = { ...sourceAnchor, pageNumber };
          if (anchorsMatch(clamped, visibleAnchor(target.getMetrics()))) continue;
          if (!synced) {
            suppressSync.current = true;
            synced = true;
          }
          target.scrollToPage({
            pageNumber,
            pageCoordinates: { x: sourceAnchor.x, y: sourceAnchor.y },
            alignX: 0,
            alignY: 0,
            behavior: "instant",
          });
        } catch {
          // A shorter report can still be loading while the original scrolls.
        }
      }
      if (synced) {
        window.setTimeout(() => {
          suppressSync.current = false;
        }, 80);
      }
    });
  }, [activeDocumentIds, scrollCapability]);

  useEffect(() => {
    if (
      !isMobile ||
      pendingRestore.current !== role ||
      !scrollCapability ||
      !zoomCapability ||
      !viewportCapability
    ) {
      return;
    }
    const documentId = DOCUMENT_ID[role];
    const shot = { ...snapshot.current };
    let cancelled = false;

    const place = () => {
      const total = scrollCapability.forDocument(documentId).getTotalPages();
      const pageNumber = clampedPageNumber(shot.pageNumber, total);
      if (pageNumber == null) return;
      scrollCapability.forDocument(documentId).scrollToPage({
        pageNumber,
        pageCoordinates: { x: shot.x, y: shot.y },
        alignX: 0,
        alignY: 0,
        behavior: "instant",
      });
    };

    const zoomMatches = () => {
      const state = zoomCapability.forDocument(documentId).getState();
      return typeof shot.zoom === "number"
        ? typeof state.zoomLevel === "number" &&
            Math.abs(state.currentZoomLevel - shot.zoom) < 0.02
        : state.zoomLevel === shot.zoom;
    };

    const apply = () => {
      if (cancelled) return;
      if (!viewportCapability.isViewportMounted(documentId)) return;
      if (scrollCapability.forDocument(documentId).getTotalPages() <= 0) return;
      suppressSync.current = true;
      if (!zoomMatches()) {
        zoomCapability.forDocument(documentId).requestZoom(shot.zoom);
      }
      place();
    };

    const stopLayout = scrollCapability.onLayoutReady((event) => {
      if (cancelled || event.documentId !== documentId) return;
      window.requestAnimationFrame(() => {
        apply();
        window.requestAnimationFrame(apply);
      });
    });

    const timer = window.setInterval(apply, 50);
    const stop = window.setTimeout(() => {
      if (cancelled) return;
      apply();
      pendingRestore.current = null;
      suppressSync.current = false;
      window.clearInterval(timer);
    }, 700);

    return () => {
      cancelled = true;
      stopLayout();
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [isMobile, role, scrollCapability, viewportCapability, zoomCapability]);

  function rememberLead(next: Role) {
    leadRef.current = next;
    setLead(next);
  }

  function scrollDocument(documentId: string, pageNumber: number) {
    try {
      const target = scrollCapability?.forDocument(documentId);
      if (!target) return;
      const page = clampedPageNumber(pageNumber, target.getTotalPages());
      if (page == null) return;
      target.scrollToPage({
        pageNumber: page,
        alignX: 0,
        alignY: 0,
        behavior: "instant",
      });
    } catch {
      // Skip a document that has not reported its page count.
    }
  }

  function jumpBoth(pageNumber: number, from: Role) {
    rememberLead(from);
    snapshot.current = { ...snapshot.current, pageNumber, x: 0, y: 0 };
    suppressSync.current = true;
    for (const documentId of activeDocumentIds) scrollDocument(documentId, pageNumber);
    window.setTimeout(() => {
      suppressSync.current = false;
    }, 120);
  }

  useEffect(() => {
    if (!focusPage || !scrollCapability) return;
    jumpBoth(focusPage.page, leadRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump when staff requests a page
  }, [focusPage, scrollCapability]);

  function requestDocumentZoom(documentId: string, zoom: ZoomLevel) {
    try {
      zoomCapability?.forDocument(documentId).requestZoom(zoom);
    } catch {
      // The evaluation pane can mount a moment after the other two.
    }
  }

  function changeZoom(mode: "in" | "out" | "fit") {
    if (!zoomCapability) return;
    suppressSync.current = true;
    if (mode === "fit") {
      for (const documentId of activeDocumentIds) requestDocumentZoom(documentId, ZoomMode.FitWidth);
      snapshot.current = { ...snapshot.current, zoom: ZoomMode.FitWidth };
    } else {
      const current =
        zoomCapability.forDocument(DOCUMENT_ID[lead]).getState()
          .currentZoomLevel || 1;
      const next =
        mode === "in" ? Math.min(current * 1.2, 4) : Math.max(current / 1.2, 0.4);
      for (const documentId of activeDocumentIds) requestDocumentZoom(documentId, next);
      snapshot.current = { ...snapshot.current, zoom: next };
    }
    window.setTimeout(() => {
      suppressSync.current = false;
    }, 150);
  }

  function showRole(next: Role) {
    if (next === role) return;
    const metrics = scrollCapability?.forDocument(DOCUMENT_ID[role]).getMetrics();
    const anchor = metrics
      ? visibleAnchor(metrics)
      : { pageNumber: pageNumber || 1, x: 0, y: 0 };
    const page = pageNumber || anchor.pageNumber || 1;
    const zoom = zoomCapability?.forDocument(DOCUMENT_ID[role]).getState();
    snapshot.current = {
      pageNumber: page,
      x: anchor.pageNumber === page ? anchor.x : 0,
      y: anchor.pageNumber === page ? anchor.y : 0,
      zoom: zoom?.currentZoomLevel || snapshot.current.zoom,
    };
    pendingRestore.current = next;
    rememberLead(next);
    setRole(next);
  }

  const pageNumber = leadScroll.currentPage || 0;
  const totalPages = Math.max(
    leadScroll.totalPages,
    originalScroll.totalPages,
    translationScroll.totalPages,
    hasEvaluation ? evaluationScroll.totalPages : 0,
  );
  const zoomPercent = Math.round((leadZoom.currentZoomLevel || 0) * 100);
  const visibleRoles: Role[] = isMobile
    ? [role]
    : hasEvaluation
      ? ["original", "translation", "evaluation"]
      : ["original", "translation"];

  async function evaluateDocument() {
    if (evaluating || !onEvaluate) return;
    setEvaluating(true);
    try {
      await onEvaluate();
    } finally {
      setEvaluating(false);
    }
  }

  function paneDocument(visible: Role) {
    if (visible === "evaluation") return order.evaluation;
    return order[visible];
  }

  function paneLabel(visible: Role) {
    if (visible === "original") return "Original";
    if (visible === "evaluation") return "Evaluation";
    return chrome === "gcs" ? "Certified Translation" : "Translation";
  }

  function openCorrection() {
    setFlagPage(pageNumber || 1);
    setCorrectionNote("");
    setCorrectionError(null);
    setCorrectionOpen(true);
  }

  useEffect(() => {
    if (!correctionOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCorrectionOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [correctionOpen]);

  async function sendCorrection() {
    const note = correctionNote.trim();
    if (!note) return;
    if (!onCorrect) {
      setCorrections((current) => [
        ...current,
        {
          id: `draft-${flagPage}-${current.length + 1}`,
          page: flagPage,
          passage: null,
          note,
          status: "sent",
          label: note.length > 42 ? `${note.slice(0, 42)}…` : note,
          detail: "sent, new preview in ~5 min",
        },
      ]);
      setCorrectionNote("");
      setCorrectionOpen(false);
      return;
    }
    setCorrectionError(null);
    try {
      await onCorrect({ page: flagPage, note });
      setCorrectionNote("");
      setCorrectionOpen(false);
    } catch (cause) {
      setCorrectionError(
        cause instanceof Error ? cause.message : "Could not send this correction.",
      );
    }
  }

  const popover = correctionOpen ? (
    <CorrectionPopover
      page={flagPage}
      note={correctionNote}
      onNote={setCorrectionNote}
      onSend={() => void sendCorrection()}
      error={correctionError}
    />
  ) : null;

  const purchase = showsPurchaseChrome(chrome);

  return (
    <PreviewShell
      layout={layout}
      order={layout === "embedded" ? undefined : order}
      notice={notice}
      noticeTestId={noticeTestId}
      rail={
        !purchase || isMobile ? undefined : (
          <OrderRail order={order} corrections={corrections} panel={panel} />
        )
      }
      mobileBar={
        purchase && isMobile ? (
          <MobileBuyBar order={order} onFlag={openCorrection} panel={panel} />
        ) : undefined
      }
      toolbar={
        <div className="flex w-full flex-col">
          <div
            className={`mx-4 mt-3 grid ${hasEvaluation ? "grid-cols-3" : "grid-cols-2"} rounded-[var(--cp-radius)] bg-[#eceff3] p-[3px] md:hidden`}
            role="group"
            aria-label="Document"
          >
            <SegmentButton
              pressed={role === "original"}
              testId="doc-toggle-original"
              onClick={() => showRole("original")}
            >
              Original
            </SegmentButton>
            <SegmentButton
              pressed={role === "translation"}
              testId="doc-toggle-translation"
              onClick={() => showRole("translation")}
            >
              Translation
            </SegmentButton>
            {hasEvaluation ? (
              <SegmentButton
                pressed={role === "evaluation"}
                testId="doc-toggle-evaluation"
                onClick={() => showRole("evaluation")}
              >
                Evaluation
              </SegmentButton>
            ) : null}
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2 md:h-[52px] md:flex-nowrap md:px-5 md:py-0">
            <IconButton
              testId="prev-page"
              label="Previous page"
              disabled={pageNumber <= 1}
              onClick={() => jumpBoth(pageNumber - 1, lead)}
            >
              ‹
            </IconButton>
            <p
              data-testid="page-status"
              className="shrink-0 text-[13px] text-ink-muted"
              aria-live="polite"
            >
              <span className="font-semibold text-ink">
                Page {pageNumber || "–"}
              </span>{" "}
              of {totalPages || "–"}
              {isMobile ? " · same spot kept" : null}
            </p>
            <IconButton
              testId="next-page"
              label="Next page"
              disabled={totalPages > 0 && pageNumber >= totalPages}
              onClick={() => jumpBoth(pageNumber + 1, lead)}
            >
              ›
            </IconButton>
            <span className="w-1.5 shrink-0" aria-hidden />
            <div className="flex shrink-0 overflow-hidden rounded-[var(--cp-radius)] border border-line">
              <button
                type="button"
                data-testid="zoom-out"
                aria-label="Zoom out"
                className="inline-flex h-8 w-8 items-center justify-center border-r border-line text-[15px] text-ink-muted"
                onClick={() => changeZoom("out")}
              >
                −
              </button>
              <span className="inline-flex h-8 min-w-12 items-center justify-center border-r border-line px-2 text-[13px] text-ink-muted tabular-nums">
                {zoomPercent || "–"}%
              </span>
              <button
                type="button"
                data-testid="zoom-in"
                aria-label="Zoom in"
                className="inline-flex h-8 w-8 items-center justify-center text-[15px] text-ink-muted"
                onClick={() => changeZoom("in")}
              >
                +
              </button>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-[var(--cp-radius)] border border-line">
              <button
                type="button"
                data-testid="fit-width"
                className="inline-flex h-8 items-center px-[11px] text-[13px] text-ink"
                onClick={() => changeZoom("fit")}
              >
                Fit width
              </button>
            </div>
            <span className="hidden flex-1 md:block" />
            <button
              type="button"
              data-testid="sync-scroll"
              className="hidden shrink-0 items-center gap-2 text-[13px] text-ink md:inline-flex"
              aria-pressed={syncScroll}
              onClick={() => setSyncScroll((value) => !value)}
            >
              <span
                className={`relative h-[18px] w-8 rounded-full ${
                  syncScroll ? "bg-primary" : "bg-line"
                }`}
              >
                <span
                  className={`absolute top-[2px] size-3.5 rounded-full bg-white ${
                    syncScroll ? "right-[2px]" : "left-[2px]"
                  }`}
                />
              </span>
              Sync scrolling
            </button>
            {purchase ? (
            <div className="relative hidden shrink-0 md:block">
              <button
                type="button"
                data-testid="flag-correction"
                className="inline-flex h-[34px] items-center rounded-[var(--cp-radius)] border border-line bg-bg px-3 text-[13px] font-semibold text-ink"
                onClick={openCorrection}
              >
                ⚑ Flag a correction
              </button>
              {popover && !isMobile ? (
                <div className="absolute top-[calc(100%+8px)] right-0 z-30">
                  {popover}
                </div>
              ) : null}
            </div>
            ) : null}
            {chrome === "gcs" ? (
            <div className="relative flex shrink-0 items-center gap-2">
              <button
                type="button"
                data-testid="flag-correction"
                className="inline-flex h-[34px] items-center rounded-[var(--cp-radius)] border border-line bg-bg px-3 text-[13px] font-semibold text-ink"
                onClick={openCorrection}
              >
                Flag a correction
              </button>
              <button
                type="button"
                data-testid="download-certified"
                className="inline-flex h-[34px] items-center rounded-[var(--cp-radius)] bg-primary px-3 text-[13px] font-semibold text-primary-ink"
                onClick={() => void onDownload?.()}
              >
                Download Certified Translation
              </button>
              <button
                type="button"
                data-testid="evaluate-document"
                className="inline-flex h-[34px] items-center rounded-[var(--cp-radius)] bg-primary px-3 text-[13px] font-semibold text-primary-ink disabled:opacity-60"
                disabled={evaluating}
                onClick={() => void evaluateDocument()}
              >
                {evaluating ? "Evaluating..." : "Evaluate Document"}
              </button>
              {popover && !isMobile ? (
                <div className="absolute top-[calc(100%+8px)] right-0 z-30">
                  {popover}
                </div>
              ) : null}
            </div>
            ) : null}
          </div>
          {popover && isMobile ? (
            <div className="fixed inset-x-4 bottom-28 z-30">{popover}</div>
          ) : null}
        </div>
      }
    >
      {visibleRoles.map((visible) => {
        const document = paneDocument(visible);
        if (!document) return null;
        return (
          <DocumentPane
            key={visible}
            role={visible}
            label={paneLabel(visible)}
            subtitle={document.subtitle}
            watermark={visible === "translation" && chrome !== "gcs"}
            onDownload={visible === "evaluation" ? onDownloadEvaluation : undefined}
            onDocumentError={onDocumentError}
          />
        );
      })}
    </PreviewShell>
  );
}

function SegmentButton({
  pressed,
  testId,
  onClick,
  children,
}: {
  pressed: boolean;
  testId: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      className={`h-9 rounded-[3px] text-sm font-semibold ${
        pressed
          ? "bg-bg text-ink shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
          : "text-ink-muted"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconButton({
  testId,
  label,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--cp-radius)] border border-line bg-bg text-[15px] text-ink-muted disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function usePreviewFileRecovery(original: string, translation: string, evaluation: string | null) {
  const [urls, setUrls] = useState<{
    original: string;
    translation: string;
    evaluation: string | null;
  } | null>(null);
  const [phase, setPhase] = useState<"open" | "recovering" | "failed">("open");
  const [sourceKey, setSourceKey] = useState(`${original}\0${translation}`);
  const attemptRef = useRef(0);
  const generation = useRef(0);
  const lock = useRef(false);
  const ownedBlobs = useRef<string[]>([]);
  const nextKey = `${original}\0${translation}`;
  if (sourceKey !== nextKey) {
    setSourceKey(nextKey);
    setUrls(null);
    setPhase("open");
  }

  useEffect(() => {
    attemptRef.current = 0;
    lock.current = false;
    return () => {
      generation.current += 1;
      lock.current = false;
      for (const url of ownedBlobs.current) URL.revokeObjectURL(url);
      ownedBlobs.current = [];
    };
  }, [sourceKey]);

  const recover = useCallback(() => {
    if (lock.current) return;
    lock.current = true;
    const gen = ++generation.current;
    setPhase("recovering");
    void (async () => {
      let next = attemptRef.current + 1;
      while (generation.current === gen) {
        const delay = delayBeforePreviewAttempt(next);
        if (delay === null) {
          setPhase("failed");
          lock.current = false;
          return;
        }
        await sleep(delay);
        if (generation.current !== gen) return;
        try {
          const [originalBlob, translationBlob, evaluationBlob] = await Promise.all([
            fetchPreviewFile(original),
            fetchPreviewFile(translation),
            evaluation ? fetchPreviewFile(evaluation) : Promise.resolve(null),
          ]);
          if (generation.current !== gen) return;
          const nextOriginal = URL.createObjectURL(originalBlob);
          const nextTranslation = URL.createObjectURL(translationBlob);
          const nextEvaluation = evaluationBlob ? URL.createObjectURL(evaluationBlob) : null;
          if (generation.current !== gen) {
            URL.revokeObjectURL(nextOriginal);
            URL.revokeObjectURL(nextTranslation);
            if (nextEvaluation) URL.revokeObjectURL(nextEvaluation);
            return;
          }
          for (const url of ownedBlobs.current) URL.revokeObjectURL(url);
          ownedBlobs.current = [nextOriginal, nextTranslation, ...(nextEvaluation ? [nextEvaluation] : [])];
          attemptRef.current = next;
          setUrls({ original: nextOriginal, translation: nextTranslation, evaluation: nextEvaluation });
          setPhase("open");
          lock.current = false;
          return;
        } catch {
          next += 1;
        }
      }
    })();
  }, [evaluation, original, translation]);

  const retry = useCallback(() => {
    generation.current += 1;
    lock.current = false;
    attemptRef.current = 0;
    for (const url of ownedBlobs.current) URL.revokeObjectURL(url);
    ownedBlobs.current = [];
    setUrls(null);
    setPhase("open");
  }, []);

  return { urls, recovering: phase === "recovering", failed: phase === "failed", recover, retry };
}

function DocumentRetrySignal({ onError }: { onError: () => void }) {
  useEffect(() => {
    onError();
  }, [onError]);
  return <p className="p-4 text-sm text-ink-muted">Opening document…</p>;
}

function DocumentPane({
  role,
  label,
  subtitle,
  watermark,
  onDownload,
  onDocumentError,
}: {
  role: Role;
  label: string;
  subtitle: string;
  watermark?: boolean;
  onDownload?: () => void | Promise<void>;
  onDocumentError: () => void;
}) {
  const documentId = DOCUMENT_ID[role];
  const documentState = useDocumentState(documentId);
  const { currentPage, totalPages } = usePageCount(documentId);
  const { state: zoomState } = useZoom(documentId);
  const { provides: zoomCapability } = useZoomCapability();
  const { provides: viewportCapability } = useViewportCapability();
  const zoom = Math.round((zoomState.currentZoomLevel || 0) * 100);
  const [zoomReady, setZoomReady] = useState(false);

  useEffect(() => {
    if (!zoomCapability) return;
    return zoomCapability.forDocument(documentId).onZoomChange((event) => {
      if (event.viewport.clientWidth <= 0) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setZoomReady(true));
      });
    });
  }, [documentId, zoomCapability]);

  useEffect(() => {
    if (documentState?.status !== "loaded" || !zoomCapability || !viewportCapability) return;
    let stopped = false;
    let interval = 0;

    const release = () => {
      if (stopped) return;
      try {
        const scope = viewportCapability.forDocument(documentId);
        const gated = scope.isGated() || viewportCapability.isGated(documentId);
        if (!gated) {
          if (interval) window.clearInterval(interval);
          return;
        }
        const metrics = scope.getMetrics();
        if (metrics.clientWidth <= 0 || metrics.clientHeight <= 0) return;
        zoomCapability.forDocument(documentId).requestZoom(ZoomMode.FitWidth);
        if (scope.isGated()) scope.releaseGate("zoom");
      } catch {
        // The viewport is registered a frame after the document reports loaded.
      }
    };

    release();
    const frame = window.requestAnimationFrame(() => {
      release();
      window.requestAnimationFrame(release);
    });
    const timers = [50, 160, 400].map((delay) => window.setTimeout(release, delay));
    interval = window.setInterval(release, 100);
    const stopResize = viewportCapability.onViewportResize((event) => {
      if (event.documentId === documentId) release();
    });
    const stop = window.setTimeout(() => window.clearInterval(interval), 2000);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(interval);
      window.clearTimeout(stop);
      stopResize();
    };
  }, [documentId, documentState?.status, viewportCapability, zoomCapability]);

  return (
    <section
      data-testid={`pane-${role}`}
      data-page={currentPage}
      data-zoom={zoom}
      data-zoom-ready={zoomReady ? "true" : "false"}
      data-total={totalPages}
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-line md:border-l md:first:border-l-0"
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 bg-bg px-5 text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="flex min-w-0 items-center gap-3">
          {onDownload ? (
            <button
              type="button"
              data-testid="download-evaluation"
              className="shrink-0 font-semibold text-primary"
              onClick={() => void onDownload()}
            >
              Download
            </button>
          ) : null}
          <span className="truncate font-normal text-ink-muted">{subtitle}</span>
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <DocumentContent documentId={documentId}>
            {({ isLoaded, isError }) =>
              isError ? (
                <DocumentRetrySignal onError={onDocumentError} />
              ) : isLoaded ? (
                <Viewport documentId={documentId}>
                  <Scroller
                    documentId={documentId}
                    renderPage={({ pageIndex, width, height }) => (
                      <div style={{ width, height, position: "relative" }}>
                        <RenderLayer
                          documentId={documentId}
                          pageIndex={pageIndex}
                        />
                      </div>
                    )}
                  />
                </Viewport>
              ) : (
                <p className="p-4 text-sm text-ink-muted">Opening document…</p>
              )
            }
          </DocumentContent>
        </div>
        {watermark ? <TranslationWatermark /> : null}
      </div>
    </section>
  );
}
