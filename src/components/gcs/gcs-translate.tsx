"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PreviewDocument, PreviewOrder } from "@/components/preview/preview-order";
import { LETTER_HEIGHT_PT, LETTER_WIDTH_PT } from "@/lib/orders/constants";
import { FlowApiError } from "@/lib/flow/api-error";
import { uploadOrderFiles } from "@/lib/flow/direct-upload";
import { publishGcsUnlock, useGcsUnlocked } from "@/lib/gcs/pin-client";
import { sourceLanguageChoices, targetLanguageChoices } from "@/lib/orders/languages";
import { gcsTranslationProgress, gcsUploadProgress, type GcsLiveProgress, type GcsOrderSnapshot } from "./gcs-progress";
import { GcsPinGate } from "./gcs-pin-gate";

const SideBySideViewer = dynamic(
  () => import("@/components/preview/side-by-side-viewer").then((mod) => mod.SideBySideViewer),
  { ssr: false, loading: () => <p className="p-8 text-sm text-[#5b6474]">Loading the certified translation…</p> },
);

const SOURCES = sourceLanguageChoices();
const TARGETS = targetLanguageChoices();

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

export function GcsTranslate({ unlocked: initialUnlocked, token }: { unlocked: boolean; token?: string | null }) {
  const router = useRouter();
  const unlocked = useGcsUnlocked(initialUnlocked);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [clientName, setClientName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState(false);
  const [uploadRatio, setUploadRatio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderPayload | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [evaluation, setEvaluation] = useState<PreviewDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const waiting = Boolean(token) && unlocked && !error && !preview;
  const elapsed = useElapsed(pending || waiting);

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
      setOrder(next);
      if (next.status === "failed" || next.status === "cancelled" || next.status === "needs_review") {
        setError(next.reviewReason?.trim() || "We could not finish this translation.");
        return;
      }
      const previewResponse = await fetch(`/api/orders/${encodeURIComponent(token!)}/preview`);
      if (stopped) return;
      if (previewResponse.ok) {
        setPreview((await previewResponse.json()) as PreviewPayload);
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

  async function start(file: File) {
    setError(null);
    setUploadRatio(null);
    setPending(true);
    try {
      const created = await uploadOrderFiles({
        files: [file],
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

  function takeFile(list: FileList | null) {
    const file = list?.[0];
    if (!file || pending) return;
    void start(file);
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
  }

  if (!unlocked) {
    return <GcsPinGate onUnlock={() => undefined} />;
  }

  if (pending) {
    const creating = uploadRatio != null && uploadRatio >= 1;
    const upload = gcsUploadProgress({ ratio: uploadRatio, elapsedMs: elapsed, creating });
    return (
      <GcsProgress
        title={creating ? "Starting the translation" : "Uploading your document"}
        progress={upload}
      />
    );
  }

  if (token) {
    if (error) {
      return (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
          <h1 className="text-2xl font-semibold">Translation needs attention</h1>
          <p className="mt-3 text-sm text-[#5b6474]">{error}</p>
        </div>
      );
    }
    if (!viewer) {
      const live = gcsTranslationProgress(order, elapsed);
      const preparing = order?.status === "confirmed" || order?.status === "processing";
      return (
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
    }
    return (
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 py-10 md:px-8">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-[#1f5eff]">CERTIFIED TRANSLATION</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.5px]">Upload one document</h1>
      <p className="mt-2 max-w-xl text-sm text-[#5b6474]">
        PDF or image. The certified translation starts as soon as the file is in, with no payment step.
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
          takeFile(event.dataTransfer.files);
        }}
        className={`mt-6 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center ${
          dragOver ? "border-[#1f5eff] bg-[#eaf0ff]" : "border-[#c9d6ff] bg-[#f7f9ff]"
        }`}
      >
        <input
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          disabled={pending}
          onChange={(event) => {
            takeFile(event.target.files);
            event.target.value = "";
          }}
        />
        <span className="text-lg font-semibold">Drop a document here</span>
        <span className="mt-2 text-sm text-[#5b6474]">or click to choose a PDF or image</span>
      </label>
      {error ? (
        <p role="alert" className="mt-4 text-sm font-semibold text-[#b42318]">
          {error}
        </p>
      ) : null}
    </div>
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
