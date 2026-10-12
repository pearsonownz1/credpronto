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
import {
  CorrectionPopover,
  MobileBuyBar,
  OrderRail,
} from "./preview-chrome";
import { PreviewShell } from "./preview-shell";
import type { PreviewCorrection, PreviewOrder } from "./preview-order";
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

export type ViewerFocus = { page: number; nonce: number };

export function SideBySideViewer({
  order,
  chrome = "customer",
  focusPage = null,
}: {
  order: PreviewOrder;
  chrome?: "customer" | "staff";
  /** Changes when staff asks the viewer to show a QA issue page. */
  focusPage?: ViewerFocus | null;
}) {
  const original = order.original.url;
  const translation = order.translation.url;
  const wasmUrl = new URL("/pdfium/pdfium.wasm", window.location.origin).href;
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl });
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
      <PreviewShell
        order={order}
        variant={chrome}
        rail={chrome === "customer" ? <OrderRail order={order} corrections={order.corrections} /> : undefined}
        status="The preview engine failed to load. Refresh to try again."
      />
    );
  }

  if (isLoading || !engine) {
    return (
      <PreviewShell
        order={order}
        variant={chrome}
        rail={chrome === "customer" ? <OrderRail order={order} corrections={order.corrections} /> : undefined}
        mobileBar={chrome === "customer" ? <MobileBuyBar order={order} onFlag={() => undefined} /> : undefined}
        status="Loading preview…"
      />
    );
  }

  return (
    <EmbedPDF
      key={`${original}:${translation}`}
      engine={engine}
      plugins={plugins}
    >
      <ViewerWorkspace order={order} chrome={chrome} focusPage={focusPage} />
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

function ViewerWorkspace({
  order,
  chrome,
  focusPage,
}: {
  order: PreviewOrder;
  chrome: "customer" | "staff";
  focusPage: ViewerFocus | null;
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
  const { provides: scrollCapability } = useScrollCapability();
  const { provides: zoomCapability } = useZoomCapability();
  const { provides: viewportCapability } = useViewportCapability();
  const leadScroll = usePageCount(DOCUMENT_ID[lead]);
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

      if (pendingRestore.current) return;

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
    const shot = { ...snapshot.current };
    let cancelled = false;

    const place = () => {
      scrollCapability.forDocument(documentId).scrollToPage({
        pageNumber: shot.pageNumber,
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

  useEffect(() => {
    if (!focusPage || !scrollCapability) return;
    jumpBoth(focusPage.page, leadRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump when staff requests a page
  }, [focusPage, scrollCapability]);

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
  const zoomPercent = Math.round((leadZoom.currentZoomLevel || 0) * 100);
  const visibleRoles: Role[] = isMobile
    ? [role]
    : ["original", "translation"];

  function openCorrection() {
    setFlagPage(pageNumber || 1);
    setCorrectionNote("");
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

  function sendCorrection() {
    const note = correctionNote.trim();
    if (!note) return;
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
  }

  const popover = correctionOpen ? (
    <CorrectionPopover
      page={flagPage}
      note={correctionNote}
      onNote={setCorrectionNote}
      onSend={sendCorrection}
    />
  ) : null;

  return (
    <PreviewShell
      order={order}
      variant={chrome}
      rail={
        chrome === "staff" || isMobile ? undefined : (
          <OrderRail order={order} corrections={corrections} />
        )
      }
      mobileBar={
        chrome === "customer" && isMobile ? (
          <MobileBuyBar order={order} onFlag={openCorrection} />
        ) : undefined
      }
      toolbar={
        <div className="flex w-full flex-col">
          <div
            className="mx-4 mt-3 grid grid-cols-2 rounded-[var(--cp-radius)] bg-[#eceff3] p-[3px] md:hidden"
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
            {chrome === "customer" ? (
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
          </div>
          {popover && isMobile ? (
            <div className="fixed inset-x-4 bottom-28 z-30">{popover}</div>
          ) : null}
        </div>
      }
    >
      {visibleRoles.map((visible) => (
        <DocumentPane
          key={visible}
          role={visible}
          label={visible === "original" ? "Original" : "Translation"}
          subtitle={order[visible].subtitle}
          watermark={visible === "translation"}
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

function DocumentPane({
  role,
  label,
  subtitle,
  watermark,
}: {
  role: Role;
  label: string;
  subtitle: string;
  watermark?: boolean;
}) {
  const documentId = DOCUMENT_ID[role];
  const { currentPage, totalPages } = usePageCount(documentId);
  const { state: zoomState } = useZoom(documentId);
  const { provides: zoomCapability } = useZoomCapability();
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
      <header className="flex h-10 shrink-0 items-center justify-between bg-bg px-5 text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="font-normal text-ink-muted">{subtitle}</span>
      </header>
      <div className="relative min-h-0 flex-1">
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
    </section>
  );
}
