"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PreviewDocument, PreviewOrder } from "@/components/preview/preview-order";
import type { GcsHistoryItem } from "@/lib/gcs/history";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "@/lib/orders/constants";
import { FlowApiError } from "@/lib/flow/api-error";
import { uploadOrderFiles } from "@/lib/flow/direct-upload";
import { publishGcsUnlock, useGcsUnlocked } from "@/lib/gcs/pin-client";
import { GCS_MAX_DOCUMENTS } from "@/lib/orders/gcs";
import { sourceLanguageChoices, targetLanguageChoices } from "@/lib/orders/languages";
import { gcsTranslationProgress, gcsUploadProgress, type GcsLiveProgress, type GcsOrderSnapshot } from "./gcs-progress";
import { GcsPinGate } from "./gcs-pin-gate";

const SideBySideViewer = dynamic(
  () => import("@/components/preview/side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <p className="p-8 text-sm text-[#5b6474]">Loading the certified translation…</p> },
);

const SOURCES = sourceLanguageChoices();
const TARGETS = targetLanguageChoices();
const HISTORY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TRANSLATING_STATUSES = new Set(["draft", "quoted", "confirmed", "processing"]);

type Frame = {
  number: number;
  widthPt: number;
  heightPt: number;
  documentId?: string;
  documentName?: string;
};

type PreviewPayload = {
  original: { url: string; pageCount: number; pages: Frame[] };
  translation: { url: string; pageCount: number; pages: Frame[] };
  billablePages: number | null;
  report?: { url: string; pageCount: number } | null;
};

type EvaluationPayload = {
  url: string;
  pageCount: number;
  pages?: Array<{ number: number; widthPt: number; heightPt: number }>;
  kind?: "course_by_course" | "diploma";
};

type OrderPayload = GcsOrderSnapshot & {
  id?: string;
  orderId?: string;
  reviewReason?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
};

function letterPages(count: number): PreviewDocument["pages"] {
  const total = Math.max(1, count || 1);
  return Array.from({ length: total }, (_, index) => ({
    page: index + 1,
    widthPt: LETTER_WIDTH_PT,
    heightPt: LETTER_HEIGHT_PT,
  }));
}

function evaluationDocument(body: EvaluationPayload): PreviewDocument {
  const pages =
    body.pages && body.pages.length > 0
      ? body.pages.map((page) => ({
          page: page.number,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
        }))
      : letterPages(body.pageCount);
  const subtitle =
    body.kind === "diploma"
      ? "Diploma evaluation"
      : body.kind === "course_by_course"
        ? "Course-by-course evaluation"
        : "Credential evaluation";
  return { url: body.url, subtitle, pages };
}

function viewerOrder(
  token: string,
  preview: PreviewPayload,
  order: OrderPayload | null,
  evaluation: PreviewDocument | null,
): PreviewOrder {
  const mapPages = (pages: Frame[]) =>
    pages.map((page) => ({
      page: page.number,
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      documentId: page.documentId,
    }));
  const translationPages = preview.translation.pages.length > 0 ? preview.translation.pages : preview.original.pages;
  return {
    id: token,
    status: "preview_ready",
    sourceLanguage: order?.sourceLanguage || "Source",
    targetLanguage: order?.targetLanguage || "English",
    filename: preview.original.pages[0]?.documentName || "Document",
    pageCount: preview.original.pageCount,
    original: { url: preview.original.url, subtitle: "Original", pages: mapPages(preview.original.pages) },
    translation: {
      url: preview.translation.url,
      subtitle: "Certified translation",
      pages: mapPages(translationPages),
    },
    ...(evaluation ? { evaluation } : {}),
    pricing: {
      perPageCents: 0,
      pages: preview.billablePages ?? preview.original.pageCount,
      certificationIncluded: true,
      totalCents: 0,
    },
    included: [],
    corrections: [],
  };
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
}

function useElapsed(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const tick = () => setElapsed(Date.now() - started);
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? elapsed : 0;
}

function historyWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${HISTORY_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function pageLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

function filenameLabel(filenames: readonly string[]): string {
  if (filenames.length === 0) return "";
  if (filenames.length === 1) return filenames[0] ?? "";
  return `${filenames[0]} + ${filenames.length - 1} more`;
}

function evaluationBadge(item: GcsHistoryItem): string | null {
  if (!item.hasEvaluation) return null;
  if (item.evaluationKind === "diploma") return "Diploma";
  if (item.evaluationKind === "course_by_course") return "Course-by-course";
  return "Evaluated";
}

export function GcsTranslate({ unlocked: initialUnlocked, token }: { unlocked: boolean; token?: string | null }) {
  const router = useRouter();
  const unlocked = useGcsUnlocked(initialUnlocked);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [clientName, setClientName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState(false);
  const [uploadCount, setUploadCount] = useState(1);
  const [uploadRatio, setUploadRatio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderPayload | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [evaluation, setEvaluation] = useState<PreviewDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<GcsHistoryItem[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const waiting = Boolean(token) && unlocked && !error && !preview;
  const elapsed = useElapsed(pending || waiting);
  const activeHistoryId = order?.id ?? order?.orderId ?? token ?? null;

  useEffect(() => {
    setOrder(null);
    setPreview(null);
    setEvaluation(null);
    setError(null);
    setNotice(null);
  }, [token]);

  useEffect(() => {
    if (!unlocked) return;
    let stopped = false;
    void (async () => {
      try {
        const response = await fetch("/api/gcs/orders");
        if (!response.ok || stopped) return;
        const body = (await response.json()) as { orders?: unknown };
        if (stopped || !Array.isArray(body.orders)) return;
        setHistory(body.orders as GcsHistoryItem[]);
      } catch {
        // The translation screen still works when the sidebar cannot load.
      } finally {
        if (!stopped) setHistoryReady(true);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [unlocked, historyVersion]);

  useEffect(() => {
    if (!token || !unlocked) return;
    let stopped = false;
    let timer = 0;

    async function poll() {
      const orderResponse = await fetch(`/api/orders/${encodeURIComponent(token!)}`);
      if (stopped) return;
      if (orderResponse.status === 404) {
        setError("This translation could not be found.");
        return;
      }
      if (!orderResponse.ok) {
        timer = window.setTimeout(() => void poll(), 2500);
        return;
      }
      const next = (await orderResponse.json()) as OrderPayload;
      if (stopped) return;
      setOrder({ ...next, id: next.id ?? next.orderId });
      if (next.status === "failed" || next.status === "cancelled" || next.status === "needs_review") {
        setError(next.reviewReason?.trim() || "We could not finish this translation.");
        return;
      }
      const previewResponse = await fetch(`/api/orders/${encodeURIComponent(token!)}/preview`);
      if (stopped) return;
      if (previewResponse.ok) {
        setPreview((await previewResponse.json()) as PreviewPayload);
        setHistoryVersion((version) => version + 1);
        return;
      }
      timer = window.setTimeout(() => void poll(), 2500);
    }

    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [token, unlocked]);

  const viewer = useMemo(() => {
    if (!token || !preview) return null;
    const fromReport = preview.report?.url
      ? evaluationDocument({ url: preview.report.url, pageCount: preview.report.pageCount })
      : null;
    return viewerOrder(token, preview, order, evaluation ?? fromReport);
  }, [token, preview, order, evaluation]);

  function lockAgain(message: string) {
    publishGcsUnlock(false);
    setError(message);
  }

  function openNewTranslation() {
    setError(null);
    setNotice(null);
    setPending(false);
    setUploadRatio(null);
    setUploadCount(1);
    setOrder(null);
    setPreview(null);
    setEvaluation(null);
    setDragOver(false);
    if (token) router.push("/gcs-translate");
  }

  function openHistory(id: string) {
    if (id === token) return;
    router.push(`/gcs-translate/${encodeURIComponent(id)}`);
  }

  async function start(files: File[]) {
    setError(null);
    setUploadRatio(null);
    setUploadCount(files.length);
    setPending(true);
    try {
      const created = await uploadOrderFiles({
        files,
        choice: { orderType: "translation" },
        brand: "gcs",
        clientName,
        sourceLanguage,
        targetLanguage,
        onProgress: (ratio) => setUploadRatio(ratio),
      });
      router.push(`/gcs-translate/${encodeURIComponent(created.orderToken)}`);
    } catch (cause) {
      if (cause instanceof FlowApiError && cause.status === 401) {
        lockAgain("Enter the PIN to start a translation.");
        return;
      }
      setError(cause instanceof Error && cause.message.trim() ? cause.message : "We couldn't upload that file.");
    } finally {
      setPending(false);
      setUploadRatio(null);
    }
  }

  function takeFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0 || pending) return;
    if (files.length > GCS_MAX_DOCUMENTS) {
      setError(`Upload at most ${GCS_MAX_DOCUMENTS} documents.`);
      return;
    }
    void start(files);
  }

  async function downloadCertified() {
    if (!token) return;
    setNotice(null);
    const response = await fetch(`/api/orders/${encodeURIComponent(token)}/download?file=translation`);
    if (!response.ok) {
      setNotice(await readError(response, "The certified PDF is not ready yet."));
      return;
    }
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== "string") {
      setNotice("The certified PDF is not ready yet.");
      return;
    }
    window.location.assign(body.url);
  }

  async function downloadEvaluation() {
    if (!token) return;
    setNotice(null);
    const response = await fetch(`/api/orders/${encodeURIComponent(token)}/download?file=evaluation`);
    if (!response.ok) {
      setNotice(await readError(response, "The evaluation is not ready yet."));
      return;
    }
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== "string") {
      setNotice("The evaluation is not ready yet.");
      return;
    }
    window.location.assign(body.url);
  }

  async function evaluateDocument() {
    if (!token) return;
    setNotice(null);
    const response = await fetch(`/api/orders/${encodeURIComponent(token)}/evaluate`, { method: "POST" });
    if (!response.ok) {
      setNotice(await readError(response, "The document could not be evaluated."));
      return;
    }
    const body = (await response.json()) as { evaluation?: EvaluationPayload };
    if (!body.evaluation || typeof body.evaluation.url !== "string") {
      setNotice("The document could not be evaluated.");
      return;
    }
    setEvaluation(evaluationDocument(body.evaluation));
    setHistoryVersion((version) => version + 1);
  }

  if (!unlocked) {
    return <GcsPinGate onUnlock={() => undefined} />;
  }

  let main: ReactNode;
  if (pending) {
    const creating = uploadRatio != null && uploadRatio >= 1;
    const upload = gcsUploadProgress({ ratio: uploadRatio, elapsedMs: elapsed, creating });
    main = (
      <GcsProgress
        title={creating ? "Starting the translation" : uploadCount > 1 ? "Uploading your documents" : "Uploading your document"}
        progress={upload}
      />
    );
  } else if (token) {
    if (error) {
      main = (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
          <h1 className="text-2xl font-semibold">Translation needs attention</h1>
          <p className="mt-3 text-sm text-[#5b6474]">{error}</p>
        </div>
      );
    } else if (!viewer) {
      const live = gcsTranslationProgress(order, elapsed);
      const preparing = order?.status === "confirmed" || order?.status === "processing";
      main = (
        <GcsProgress
          title="Translating your document"
          detail={
            preparing
              ? "The certified translation is being prepared."
              : "Reading the document and starting the translation."
          }
          progress={live}
        />
      );
    } else {
      main = (
        <div className="min-h-0 flex-1">
          <SideBySideViewer
            order={viewer}
            chrome="gcs"
            shellLayout="embedded"
            notice={notice ?? undefined}
            onDownload={downloadCertified}
            onEvaluate={evaluateDocument}
            onDownloadEvaluation={downloadEvaluation}
            onCorrect={async ({ note }) => {
              const response = await fetch(`/api/orders/${encodeURIComponent(token)}/correction-request`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ text: note }),
              });
              if (!response.ok) throw new Error(await readError(response, "Could not send this correction."));
            }}
          />
        </div>
      );
    }
  } else {
    main = (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-10 md:px-8">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-[#1f5eff]">CERTIFIED TRANSLATION</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.5px]">Upload documents</h1>
        <p className="mt-2 max-w-xl text-sm text-[#5b6474]">
          One or more PDFs or images, up to {GCS_MAX_DOCUMENTS} files, combined into one certified translation with no
          payment step.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <label className="block text-sm font-semibold">
            Source language
            <select
              value={sourceLanguage}
              onChange={(event) => setSourceLanguage(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-[#d5dbe6] bg-white px-3 font-normal"
            >
              <option value="auto">Auto-detect</option>
              {SOURCES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Target language
            <select
              value={targetLanguage}
              onChange={(event) => setTargetLanguage(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-[#d5dbe6] bg-white px-3 font-normal"
            >
              {TARGETS.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Client name
            <input
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder="Optional"
              className="mt-2 h-11 w-full rounded-xl border border-[#d5dbe6] px-3 font-normal"
            />
          </label>
        </div>
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            takeFiles(event.dataTransfer.files);
          }}
          className={`mt-6 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center ${
            dragOver ? "border-[#1f5eff] bg-[#eaf0ff]" : "border-[#c9d6ff] bg-[#f7f9ff]"
          }`}
        >
          <input
            type="file"
            multiple
            accept="application/pdf,image/*"
            className="sr-only"
            disabled={pending}
            onChange={(event) => {
              takeFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="text-lg font-semibold">Drop documents here</span>
          <span className="mt-2 text-sm text-[#5b6474]">or click to choose one or more PDFs or images</span>
        </label>
        {error ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-[#b42318]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <GcsHistorySidebar
        items={history}
        ready={historyReady}
        activeId={activeHistoryId}
        onOpen={openHistory}
        onNew={openNewTranslation}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main}</div>
    </div>
  );
}

function GcsHistorySidebar({
  items,
  ready,
  activeId,
  onOpen,
  onNew,
}: {
  items: GcsHistoryItem[];
  ready: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside
      data-testid="gcs-history-sidebar"
      className="flex w-64 shrink-0 flex-col border-r border-[#e4e8f0] bg-[#f8fafc] md:w-72"
    >
      <div className="border-b border-[#e4e8f0] p-3">
        <button
          type="button"
          data-testid="gcs-new-translation"
          onClick={onNew}
          className="flex h-10 w-full items-center justify-center rounded-xl bg-[#1f5eff] px-3 text-sm font-semibold text-white"
        >
          + New Translation
        </button>
        <h2 className="mt-4 text-[11px] font-semibold tracking-[0.14em] text-[#5b6474]">Previous translations</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[#5b6474]">{ready ? "No translations yet." : "Loading translations…"}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const active = item.id === activeId;
              const files = filenameLabel(item.filenames);
              const badge = evaluationBadge(item);
              const when = historyWhen(item.createdAt);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid="gcs-history-item"
                    data-active={active ? "true" : "false"}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onOpen(item.id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left ${
                      active ? "bg-white shadow-sm ring-1 ring-[#1f5eff]" : "hover:bg-white"
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold text-[#0b1220]">{item.title}</span>
                    {files && files !== item.title ? (
                      <span className="mt-0.5 block truncate text-xs text-[#5b6474]">{files}</span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-[#eaf0ff] px-2 py-0.5 text-[10px] font-semibold text-[#1f5eff]">
                        {TRANSLATING_STATUSES.has(item.status) ? "Translating…" : "Translated"}
                      </span>
                      {badge ? (
                        <span className="rounded-full bg-[#e8f6f0] px-2 py-0.5 text-[10px] font-semibold text-[#067647]">
                          {badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1.5 block text-xs text-[#5b6474]">
                      {when ? `${when} · ${pageLabel(item.pageCount)}` : pageLabel(item.pageCount)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function GcsProgress({
  title,
  detail,
  progress,
}: {
  title: string;
  detail?: string;
  progress: GcsLiveProgress;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16" data-testid="gcs-progress">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-[#1f5eff]">CERTIFIED TRANSLATION</p>
      <h1 className="mt-3 text-2xl font-semibold">{title}</h1>
      {detail ? <p className="mt-3 text-sm text-[#5b6474]">{detail}</p> : null}
      <div className="mt-8 w-full text-left">
        <div className="mb-2 flex items-baseline justify-between gap-4 text-[13px]">
          <span className="font-medium text-ink" data-testid="gcs-progress-stage">
            {progress.progressStage}
          </span>
          <span className="shrink-0 font-medium text-ink tabular-nums" data-testid="gcs-progress-percent">
            {progress.progressPct}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={progress.progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${progress.progressPct}%`}
          aria-label={progress.progressStage}
          data-testid="gcs-progress-bar"
          className="h-2 overflow-hidden rounded-[2px] bg-line"
        >
          <div
            className="reading-fill relative h-full overflow-hidden bg-primary"
            style={{ width: `${progress.barPercent}%` }}
          >
            <span className="reading-shine pointer-events-none absolute inset-0 motion-reduce:hidden" aria-hidden />
          </div>
        </div>
        {progress.steps.length > 0 ? (
          <ol data-testid="gcs-progress-steps" className="mt-6 list-none space-y-2.5 p-0">
            {progress.steps.map((step) => (
              <li
                key={step.id}
                data-testid={`gcs-progress-step-${step.id}`}
                data-state={step.state}
                aria-current={step.state === "current" ? "step" : undefined}
                className={`flex items-center gap-3 text-[14px] leading-5 ${
                  step.state === "pending" ? "text-ink-muted" : "text-ink"
                } ${step.state === "current" ? "font-medium" : ""}`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <StepMark state={step.state} />
                </span>
                {step.label}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

function StepMark({ state }: { state: "done" | "current" | "pending" }) {
  if (state === "done") {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4 text-primary" aria-hidden>
        <path
          d="M3.2 8.4 6.4 11.4 12.8 4.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "current") {
    return <span className="reading-spinner block h-3.5 w-3.5 rounded-full" aria-hidden />;
  }
  return <span className="block h-2 w-2 rounded-full bg-[#c5cbd6]" aria-hidden />;
}
