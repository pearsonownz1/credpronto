"use client";

import Link from "next/link";
import { useState, type DragEvent, type FormEvent } from "react";
import { buttonClasses, fieldClass } from "@/components/flow/ui";
import type { PreEvaluationConfidence } from "@/lib/pre-evaluation/client";
import { PRE_EVALUATION_ACCEPT, preEvaluationFileError } from "@/lib/pre-evaluation/file";
import { officialEvaluationSignupHref } from "@/lib/pre-evaluation/handoff";
import type { PreEvaluationProgress } from "@/lib/pre-evaluation/progress";
import { previewWatermarkDataUrl } from "@/lib/pre-evaluation/watermark";

export const CONFIDENCE_PERCENT: Record<PreEvaluationConfidence, number> = {
  low: 33,
  medium: 66,
  high: 100,
};

const CONFIDENCE_LABEL: Record<PreEvaluationConfidence, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const CONFIDENCE_TONE: Record<PreEvaluationConfidence, string> = {
  low: "bg-[#f3f4f6] text-[#5b6474]",
  medium: "bg-[#fff4e5] text-[#b45309]",
  high: "bg-[#e7f6ef] text-[#12805c]",
};

function Alert({ message, rateLimited }: { message: string | null; rateLimited: boolean }) {
  if (!message && !rateLimited) return null;
  return (
    <div role="alert" data-testid={rateLimited ? "pre-evaluation-rate-limit" : undefined} className="mt-3 text-sm text-[var(--cp-warn)]">
      {rateLimited ? <p className="font-semibold">Too many previews</p> : null}
      {message ? <p className={rateLimited ? "mt-1" : undefined}>{message}</p> : null}
    </div>
  );
}

export function PreEvaluationUpload({
  message,
  rateLimited,
  pending,
  onSubmit,
}: {
  message: string | null;
  rateLimited: boolean;
  pending: boolean;
  onSubmit: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  function takeFiles(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (files.length > 1) {
      setFile(null);
      setLocalError("Upload one diploma or transcript.");
      return;
    }
    const next = files[0] ?? null;
    setFile(next);
    setLocalError(next ? preEvaluationFileError(next) : null);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    takeFiles(event.dataTransfer.files);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = preEvaluationFileError(file);
    if (problem) {
      setLocalError(problem);
      return;
    }
    if (file) onSubmit(file);
  }

  const shown = localError || message;

  return (
    <div data-testid="pre-evaluation-upload" className="mx-auto w-full max-w-[620px] px-4 py-12">
      <p className="preview-kicker blue">Free preview</p>
      <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px]">Check a diploma or transcript</h1>
      <p className="mt-3 text-base text-ink-muted">
        Upload one file for a free preview of the likely U.S. equivalent. This is not an official evaluation.
      </p>
      <form onSubmit={submit} className="mt-8" noValidate>
        <div
          data-testid="upload-drop"
          className="rounded-[4px] border-[1.5px] border-dashed border-[#b9c3d6] bg-[var(--cp-blue-l)] px-4 py-6 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <div className="text-[26px] leading-none text-primary" aria-hidden>
            ⤒
          </div>
          <div className="mt-1.5 font-semibold">
            Drop a file or{" "}
            <label className="cursor-pointer text-primary">
              browse
              <input
                data-testid="file-input"
                type="file"
                accept={PRE_EVALUATION_ACCEPT}
                className="sr-only"
                disabled={pending}
                onChange={(event) => {
                  takeFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">PDF, JPG, or PNG · 50MB or smaller</p>
        </div>
        {file ? (
          <p data-testid="file-name" className="mt-3 truncate text-[13.5px]">
            {file.name}
          </p>
        ) : null}
        <Alert message={shown} rateLimited={rateLimited && !localError} />
        <button
          type="submit"
          data-testid="start-preview"
          disabled={pending}
          className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px] disabled:opacity-60")}
        >
          {pending ? "Uploading…" : "Check my document"}
        </button>
      </form>
    </div>
  );
}

export function PreEvaluationChecking() {
  return (
    <div data-testid="pre-evaluation-checking" className="mx-auto w-full max-w-[620px] px-4 py-16 text-center">
      <h1 className="text-[32px] font-bold tracking-[-0.6px]">Checking your document…</h1>
    </div>
  );
}

export function PreEvaluationProcessing({ progress }: { progress: PreEvaluationProgress }) {
  return (
    <div data-testid="pre-evaluation-processing" className="mx-auto w-full max-w-[620px] px-4 py-16 text-center">
      <h1 className="text-[32px] font-bold tracking-[-0.6px]">Preparing your preview</h1>
      <p className="mt-3 text-base text-ink-muted">This usually takes about a minute.</p>
      <div className="mx-auto mt-8 w-full max-w-[520px] text-left">
        <div className="mb-2 flex items-baseline justify-between gap-4 text-[13px]">
          <span className="font-medium text-ink" data-testid="preview-progress-label">
            {progress.label}
          </span>
          <span className="shrink-0 font-medium text-ink tabular-nums" data-testid="preview-progress-percent">
            {progress.displayPercent}%
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-[2px] bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.displayPercent}
          aria-valuetext={`${progress.displayPercent}%`}
          aria-label={progress.label}
          data-testid="preview-progress"
        >
          <div className="reading-fill relative h-full overflow-hidden bg-primary" style={{ width: `${progress.percent}%` }}>
            <span className="reading-shine pointer-events-none absolute inset-0 motion-reduce:hidden" aria-hidden />
          </div>
        </div>
        <ol data-testid="preview-progress-steps" className="mt-6 list-none space-y-2.5 p-0">
          {progress.steps.map((step) => (
            <li
              key={step.id}
              data-testid={`preview-step-${step.id}`}
              data-state={step.state}
              aria-current={step.state === "current" ? "step" : undefined}
              className={`flex items-center gap-3 text-[14px] leading-5 ${step.state === "pending" ? "text-ink-muted" : "text-ink"} ${step.state === "current" ? "font-medium" : ""}`}
            >
              {step.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function PreEvaluationEmailGate({
  message,
  rateLimited,
  pending,
  onSubmit,
}: {
  message: string | null;
  rateLimited: boolean;
  pending: boolean;
  onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(email);
  }

  return (
    <div data-testid="pre-evaluation-email" className="mx-auto w-full max-w-[620px] px-4 py-12">
      <p className="preview-kicker blue">Free preview</p>
      <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px]">Unlock your free preview</h1>
      <p className="mt-3 text-base text-ink-muted">
        Enter your email to see the likely U.S. equivalent. We&apos;ll email the preview to you as well. This is a free
        preview, not an official evaluation.
      </p>
      <div
        data-testid="pre-evaluation-locked"
        className="mt-8 rounded-[4px] border border-dashed border-[#b9c3d6] bg-[var(--cp-blue-l)] px-4 py-8 text-center"
      >
        <p className="font-semibold">Your result stays locked until you enter an email.</p>
      </div>
      <form onSubmit={submit} className="mt-6" noValidate>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold">Email</span>
          <input
            data-testid="preview-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        <Alert message={message} rateLimited={rateLimited} />
        <button
          type="submit"
          data-testid="unlock-preview"
          disabled={pending}
          className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px] disabled:opacity-60")}
        >
          {pending ? "Sending…" : "Show my preview"}
        </button>
      </form>
    </div>
  );
}

function PreviewWatermark() {
  return (
    <div
      aria-hidden
      data-testid="pre-evaluation-watermark"
      className="pointer-events-none absolute inset-0 z-10 select-none"
      style={{
        backgroundImage: previewWatermarkDataUrl(),
        backgroundRepeat: "repeat",
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  );
}

function PreviewFrame({ url }: { url: string }) {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  const image = /\.(png|jpe?g|gif|webp)$/.test(path);
  if (image) {
    return (
      // The preview host comes from the API. next/image cannot allow it ahead of time.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="Preview of the likely U.S. equivalent" className="mt-4 w-full" />
    );
  }
  return (
    <iframe
      title="Likely U.S. equivalent preview"
      src={url}
      className="mt-4 h-72 w-full border-0 bg-white"
      referrerPolicy="no-referrer"
    />
  );
}

export function PreEvaluationResult({
  id,
  email,
  equivalent,
  confidence,
  previewUrl,
}: {
  id: string;
  email: string;
  equivalent: string;
  confidence: PreEvaluationConfidence;
  previewUrl: string | null;
}) {
  const href = officialEvaluationSignupHref({ id, email });
  const percent = CONFIDENCE_PERCENT[confidence];
  return (
    <div data-testid="pre-evaluation-result" className="mx-auto w-full max-w-[1040px] px-4 py-10">
      <p className="preview-kicker blue">Free preview</p>
      <h1 className="mt-3 text-[32px] font-bold tracking-[-0.6px]">Likely U.S. equivalent</h1>
      <p className="mt-2 max-w-[640px] text-base text-ink-muted">This is a free preview, not an official evaluation.</p>
      <section className="mt-8 rounded-[4px] border border-line bg-white p-4 md:p-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <article
            data-testid="pre-evaluation-document"
            className="relative min-h-[420px] overflow-hidden rounded-[4px] border border-line bg-white"
          >
            <div className="relative px-6 pt-6 pb-16">
              <div className="rounded-[4px] border border-[#c9d6ff] bg-[var(--cp-blue-l)] px-4 py-4">
                <p className="text-[11px] font-semibold tracking-[0.06em] text-primary uppercase">Likely U.S. equivalent</p>
                <p data-testid="pre-evaluation-equivalent" className="mt-1 text-[18px] leading-snug font-bold tracking-[-0.3px]">
                  {equivalent}
                </p>
              </div>
              {previewUrl ? <PreviewFrame url={previewUrl} /> : null}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-[#0b1220] px-4 py-3 text-center text-[12px] font-semibold tracking-[0.04em] text-white">
              PREVIEW ONLY · OFFICIAL EVALUATION REQUIRED
            </div>
            <PreviewWatermark />
          </article>
          <aside className="flex flex-col gap-4">
            <div>
              <p className="text-[13px] font-semibold">Confidence</p>
              <span
                data-testid="confidence-pill"
                data-confidence={confidence}
                className={`mt-2 inline-flex rounded-[4px] px-2.5 py-1 text-[12px] font-semibold ${CONFIDENCE_TONE[confidence]}`}
              >
                {CONFIDENCE_LABEL[confidence]}
              </span>
              <div
                className="mt-4 h-2 overflow-hidden rounded-[2px] bg-line"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label="Based on EDGE equivalency data"
                data-testid="confidence-bar"
              >
                <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-[12.5px] text-ink-muted">Based on EDGE equivalency data</p>
            </div>
            <div>
              <Link href={href} data-testid="official-evaluation" className={buttonClasses("primary", "h-12 w-full text-[15px]")}>
                Get my official evaluation
              </Link>
              <p className="mt-2 text-center text-[13px] text-ink-muted">ready in about 5 minutes</p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

export function PreEvaluationError({
  message,
  rateLimited,
  retryable,
  onRetry,
  onReset,
}: {
  message: string;
  rateLimited: boolean;
  retryable: boolean;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div data-testid="pre-evaluation-error" className="mx-auto w-full max-w-[620px] px-4 py-16 text-center">
      <h1 className="text-[32px] font-bold tracking-[-0.6px]">{rateLimited ? "Too many previews" : "We couldn't make a preview"}</h1>
      <p role="alert" data-testid={rateLimited ? "pre-evaluation-rate-limit" : undefined} className="mt-3 text-base text-ink-muted">
        {message}
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {retryable ? (
          <button type="button" onClick={onRetry} className={buttonClasses("primary", "h-11 px-5 text-[15px]")}>
            Try again
          </button>
        ) : null}
        <button
          type="button"
          onClick={onReset}
          className={buttonClasses(retryable ? "secondary" : "primary", "h-11 px-5 text-[15px]")}
        >
          Upload a different file
        </button>
      </div>
    </div>
  );
}
