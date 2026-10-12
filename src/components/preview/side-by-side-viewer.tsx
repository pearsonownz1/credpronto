"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from "@embedpdf/plugin-document-manager/react";
import { InteractionManagerPluginPackage } from "@embedpdf/plugin-interaction-manager/react";
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react";
import {
  Scroller,
  ScrollPluginPackage,
  ScrollStrategy,
  useScroll,
  useScrollCapability,
} from "@embedpdf/plugin-scroll/react";
import {
  ThumbImg,
  ThumbnailPluginPackage,
  ThumbnailsPane,
  type ThumbMeta,
} from "@embedpdf/plugin-thumbnail/react";
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
import { PreviewShell } from "./preview-shell";
import { anchorsMatch, visibleAnchor, type ScrollAnchor } from "./scroll-anchor";
import { TranslationWatermark } from "./translation-watermark";

export const ORIGINAL_DOCUMENT_ID = "original";
export const TRANSLATION_DOCUMENT_ID = "translation";

const MOBILE_QUERY = "(max-width: 767px)";

type Role = "original" | "translation";

const DOCUMENT_ID: Record<Role, string> = {
  original: ORIGINAL_DOCUMENT_ID,
  translation: TRANSLATION_DOCUMENT_ID,
};

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

export function SideBySideViewer({
  original,
  translation,
}: {
  original: string;
  translation: string;
}) {
  const { engine, isLoading, error } = usePdfiumEngine();
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [
          { url: original, documentId: ORIGINAL_DOCUMENT_ID, name: "Original" },
          {
            url: translation,
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
    [original, translation],
  );

  if (error) {
    return (
      <PreviewShell status="The preview engine failed to load. Refresh to try again." />
    );
  }

  if (isLoading || !engine) {
    return <PreviewShell status="Loading preview…" />;
  }

  return (
    <EmbedPDF
      key={`${original}:${translation}`}
      engine={engine}
      plugins={plugins}
    >
      <ViewerWorkspace />
    </EmbedPDF>
  );
}

function usePageCount(documentId: string) {
  const scroll = useScroll(documentId);
  const { provides } = useScrollCapability();
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    if (!provides) return;

    const sync = () => {
      const count = provides.forDocument(documentId).getTotalPages();
      if (count > 0) setTotalPages(count);
    };

    sync();
    const timers = [100, 400, 1000].map((delay) => window.setTimeout(sync, delay));
    const stopLayout = provides.onLayoutReady((event) => {
      if (event.documentId === documentId && event.totalPages > 0) {
        setTotalPages(event.totalPages);
      }
    });
    const stopPage = provides.onPageChange((event) => {
      if (event.documentId === documentId && event.totalPages > 0) {
        setTotalPages(event.totalPages);
      }
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      stopLayout();
      stopPage();
    };
  }, [documentId, provides]);

  return {
    currentPage: scroll.state.currentPage,
    totalPages: totalPages || scroll.state.totalPages,
  };
}

function ViewerWorkspace() {
  const isMobile = useIsMobile();
  const [role, setRole] = useState<Role>("original");
  const [lead, setLead] = useState<Role>("original");
  const [syncScroll, setSyncScroll] = useState(true);
  const { provides: scrollCapability } = useScrollCapability();
  const { provides: zoomCapability } = useZoomCapability();
  const { provides: viewportCapability } = useViewportCapability();
  const leadScroll = usePageCount(DOCUMENT_ID[lead]);
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

  useEffect(() => {
    syncScrollRef.current = syncScroll;
    leadRef.current = lead;
  }, [lead, syncScroll]);

  useEffect(() => {
    if (!scrollCapability) return;

    return scrollCapability.onScroll((event) => {
      const sourceRole: Role =
        event.documentId === TRANSLATION_DOCUMENT_ID
          ? "translation"
          : "original";
      if (
        event.documentId !== ORIGINAL_DOCUMENT_ID &&
        event.documentId !== TRANSLATION_DOCUMENT_ID
      ) {
        return;
      }

      const sourceAnchor = visibleAnchor(event.metrics);
      snapshot.current = { ...snapshot.current, ...sourceAnchor };

      if (leadRef.current !== sourceRole && !suppressSync.current) {
        leadRef.current = sourceRole;
        setLead(sourceRole);
      }

      if (suppressSync.current || !syncScrollRef.current) return;

      const targetId =
        event.documentId === ORIGINAL_DOCUMENT_ID
          ? TRANSLATION_DOCUMENT_ID
          : ORIGINAL_DOCUMENT_ID;
      const targetAnchor = visibleAnchor(
        scrollCapability.forDocument(targetId).getMetrics(),
      );
      if (anchorsMatch(sourceAnchor, targetAnchor)) return;

      suppressSync.current = true;
      scrollCapability.forDocument(targetId).scrollToPage({
        pageNumber: sourceAnchor.pageNumber,
        pageCoordinates: { x: sourceAnchor.x, y: sourceAnchor.y },
        alignX: 0,
        alignY: 0,
        behavior: "instant",
      });
      window.setTimeout(() => {
        suppressSync.current = false;
      }, 80);
    });
  }, [scrollCapability]);

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
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const mounted = viewportCapability.isViewportMounted(documentId);
      const scope = scrollCapability.forDocument(documentId);
      if (mounted && scope.getTotalPages() > 0) {
        suppressSync.current = true;
        zoomCapability.forDocument(documentId).requestZoom(snapshot.current.zoom);
        scope.scrollToPage({
          pageNumber: snapshot.current.pageNumber,
          pageCoordinates: { x: snapshot.current.x, y: snapshot.current.y },
          alignX: 0,
          alignY: 0,
          behavior: "instant",
        });
        pendingRestore.current = null;
        window.setTimeout(() => {
          suppressSync.current = false;
        }, 200);
        window.clearInterval(timer);
      } else if (tries > 40) {
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [isMobile, role, scrollCapability, viewportCapability, zoomCapability]);

  function rememberLead(next: Role) {
    leadRef.current = next;
    setLead(next);
  }

  function jumpBoth(pageNumber: number, from: Role) {
    rememberLead(from);
    snapshot.current = { ...snapshot.current, pageNumber, x: 0, y: 0 };
    suppressSync.current = true;
    for (const documentId of [
      ORIGINAL_DOCUMENT_ID,
      TRANSLATION_DOCUMENT_ID,
    ]) {
      scrollCapability?.forDocument(documentId).scrollToPage({
        pageNumber,
        alignX: 0,
        alignY: 0,
        behavior: "instant",
      });
    }
    window.setTimeout(() => {
      suppressSync.current = false;
    }, 120);
  }

  function changeZoom(mode: "in" | "out" | "fit") {
    if (!zoomCapability) return;
    suppressSync.current = true;
    const ids = [ORIGINAL_DOCUMENT_ID, TRANSLATION_DOCUMENT_ID];
    if (mode === "fit") {
      for (const documentId of ids) {
        zoomCapability.forDocument(documentId).requestZoom(ZoomMode.FitWidth);
      }
      snapshot.current = { ...snapshot.current, zoom: ZoomMode.FitWidth };
    } else {
      const current =
        zoomCapability.forDocument(DOCUMENT_ID[lead]).getState()
          .currentZoomLevel || 1;
      const next =
        mode === "in" ? Math.min(current * 1.2, 4) : Math.max(current / 1.2, 0.4);
      for (const documentId of ids) {
        zoomCapability.forDocument(documentId).requestZoom(next);
      }
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
  const totalPages = leadScroll.totalPages || 0;
  const visibleRoles: Role[] = isMobile
    ? [role]
    : ["original", "translation"];

  return (
    <PreviewShell
      toolbar={
        <div className="flex h-12 w-full items-center gap-2 overflow-x-auto">
          <div
            className="flex shrink-0 rounded-[var(--cp-radius)] border border-line p-0.5 md:hidden"
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
          </div>
          <button
            type="button"
            data-testid="prev-page"
            className="toolbar-button"
            disabled={pageNumber <= 1}
            onClick={() => jumpBoth(pageNumber - 1, lead)}
          >
            Prev
          </button>
          <p
            data-testid="page-status"
            className="shrink-0 text-sm tabular-nums text-ink"
            aria-live="polite"
          >
            Page {pageNumber || "–"} of {totalPages || "–"}
          </p>
          <button
            type="button"
            data-testid="next-page"
            className="toolbar-button"
            disabled={totalPages > 0 && pageNumber >= totalPages}
            onClick={() => jumpBoth(pageNumber + 1, lead)}
          >
            Next
          </button>
          <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
          <button
            type="button"
            data-testid="zoom-out"
            className="toolbar-button"
            onClick={() => changeZoom("out")}
          >
            Zoom out
          </button>
          <button
            type="button"
            data-testid="zoom-in"
            className="toolbar-button"
            onClick={() => changeZoom("in")}
          >
            Zoom in
          </button>
          <button
            type="button"
            data-testid="fit-width"
            className="toolbar-button"
            onClick={() => changeZoom("fit")}
          >
            Fit width
          </button>
          <button
            type="button"
            data-testid="sync-scroll"
            className="toolbar-button hidden md:inline-flex"
            aria-pressed={syncScroll}
            onClick={() => setSyncScroll((value) => !value)}
          >
            Sync scroll
          </button>
        </div>
      }
    >
      {visibleRoles.map((visible) => (
        <DocumentPane
          key={visible}
          role={visible}
          label={visible === "original" ? "Original" : "Translation"}
          watermark={visible === "translation"}
          onJump={(page) => jumpBoth(page, visible)}
        />
      ))}
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
      className={`h-7 rounded-[var(--cp-radius)] px-2.5 text-sm ${
        pressed ? "bg-primary text-primary-ink" : "text-ink"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DocumentPane({
  role,
  label,
  watermark,
  onJump,
}: {
  role: Role;
  label: string;
  watermark?: boolean;
  onJump: (pageNumber: number) => void;
}) {
  const documentId = DOCUMENT_ID[role];
  const { currentPage, totalPages } = usePageCount(documentId);
  const { state: zoomState } = useZoom(documentId);
  const zoom = Math.round((zoomState.currentZoomLevel || 0) * 100);

  return (
    <section
      data-testid={`pane-${role}`}
      data-page={currentPage}
      data-zoom={zoom}
      data-total={totalPages}
      aria-label={label}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-line md:border-l md:first:border-l-0"
    >
      <h2 className="flex h-8 shrink-0 items-center border-b border-line px-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </h2>
      <div className="flex min-h-0 flex-1">
        <div className="relative w-[4.75rem] shrink-0 border-r border-line bg-bg">
          <div className="absolute inset-0">
            <ThumbnailsPane documentId={documentId}>
              {(meta: ThumbMeta) => (
                <button
                  type="button"
                  data-testid={`thumb-${role}-${meta.pageIndex + 1}`}
                  className="absolute right-1 left-1"
                  style={{ top: meta.top }}
                  onClick={() => onJump(meta.pageIndex + 1)}
                >
                  <ThumbImg documentId={documentId} meta={meta} />
                </button>
              )}
            </ThumbnailsPane>
          </div>
        </div>
        <div className="relative min-w-0 flex-1 bg-bg-muted">
          <div className="absolute inset-0">
            <DocumentContent documentId={documentId}>
              {({ isLoaded, isError }) =>
                isError ? (
                  <p className="p-4 text-sm text-ink">
                    This document could not be opened.
                  </p>
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
      </div>
    </section>
  );
}
