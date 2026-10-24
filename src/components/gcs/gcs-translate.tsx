"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PreviewOrder } from "@/components/preview/preview-order";
import { FlowApiError } from "@/lib/flow/api-error";
import { uploadOrderFiles } from "@/lib/flow/direct-upload";
import { publishGcsUnlock, useGcsUnlocked } from "@/lib/gcs/pin-client";
import { sourceLanguageChoices, targetLanguageChoices } from "@/lib/orders/languages";
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
};

type OrderPayload = {
  status?: string;
  reviewReason?: string | null;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
};

function viewerOrder(token: string, preview: PreviewPayload, order: OrderPayload | null): PreviewOrder {
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

export function GcsTranslate({ unlocked: initialUnlocked, token }: { unlocked: boolean; token?: string | null }) {
  const router = useRouter();
  const unlocked = useGcsUnlocked(initialUnlocked);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [clientName, setClientName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderPayload | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const viewer = useMemo(
    () => (token && preview ? viewerOrder(token, preview, order) : null),
    [token, preview, order],
  );

  function lockAgain(message: string) {
    publishGcsUnlock(false);
    setError(message);
  }

  async function start(file: File) {
    setError(null);
    setPending(true);
    try {
      const created = await uploadOrderFiles({
        files: [file],
        choice: { orderType: "translation" },
        brand: "gcs",
        clientName,
        sourceLanguage,
        targetLanguage,
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

  if (!unlocked) {
    return <GcsPinGate onUnlock={() => undefined} />;
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
      return (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-[#1f5eff]">CERTIFIED TRANSLATION</p>
          <h1 className="mt-3 text-2xl font-semibold">Translating your document</h1>
          <p className="mt-3 text-sm text-[#5b6474]">
            {order?.status === "confirmed" || order?.status === "processing"
              ? "The certified translation is being prepared."
              : "Reading the document and starting the translation."}
          </p>
        </div>
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
        <span className="text-lg font-semibold">{pending ? "Starting the translation…" : "Drop a document here"}</span>
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
