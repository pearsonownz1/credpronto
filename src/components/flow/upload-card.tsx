"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { knownPageCount } from "@/lib/analytics/google-ads";
import { trackOrderUpload } from "@/lib/analytics/gtag-events";
import { FlowApiError, flowUsesMock, getFlowClient } from "@/lib/flow/client";
import {
  parseEvaluationService,
  uploadChoiceFromSelection,
  type UploadChoice,
} from "@/lib/flow/order-choice";
import { pageLabel } from "@/lib/flow/pricing";
import { dedupeUploads } from "@/lib/flow/uploads";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import { writeEmail, writeToken } from "@/lib/flow/session";
import { rememberUpload } from "@/lib/flow/upload-blobs";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_ADDON,
  TRANSLATION_PAGE_LABEL,
} from "@/lib/evaluations/catalog";
import type { EvaluationService } from "@/lib/orders/types";
import { buttonClasses, fieldClass } from "./ui";

type ListedFile = {
  id: string;
  name: string;
  pages: number | null;
  kind: "pdf" | "image";
};

const SAMPLE_FILES: ListedFile[] = sampleCustomerOrder().documents.map((document) => ({
  id: document.id,
  name: document.filename,
  pages: document.pageCount,
  kind: document.filename.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
}));

const PRODUCTS: Array<{
  id: "translation" | EvaluationService;
  label: string;
  price: string;
}> = [
  { id: "translation", label: "Translation", price: TRANSLATION_PAGE_LABEL },
  { id: "diploma", label: "Diploma evaluation", price: DIPLOMA_PRICE_LABEL },
  { id: "course_by_course", label: "Course-by-course", price: COURSE_BY_COURSE_PRICE_LABEL },
];

export function UploadCard({
  intro,
  initialService,
}: {
  intro?: { title: string; lede: string };
  initialService?: string | null;
}) {
  const router = useRouter();
  const mock = flowUsesMock();
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(mock ? "maria.ruiz@email.com" : "");
  const [picked, setPicked] = useState<File[]>([]);
  const [product, setProduct] = useState<"translation" | EvaluationService>(
    parseEvaluationService(initialService) ?? "translation",
  );
  const [degrees, setDegrees] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const files: ListedFile[] =
    mock && picked.length === 0
      ? SAMPLE_FILES
      : picked.map((file) => ({
          id: `${file.name}-${file.size}`,
          name: file.name,
          pages: null,
          kind: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
            ? "pdf"
            : "image",
        }));
  const pageCount = knownPageCount(files.map((file) => file.pages));

  function takeFiles(list: FileList | null) {
    if (!list || mock) return;
    setPicked(dedupeUploads(Array.from(list)));
  }

  function choice(): UploadChoice | null {
    if (product === "translation") return { orderType: "translation" };
    const degreeCount = Number(degrees);
    if (!Number.isInteger(degreeCount) || degreeCount < 1) return null;
    return uploadChoiceFromSelection(product, degreeCount);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const selected = choice();
    if (!selected) {
      setError("Enter at least 1 degree.");
      return;
    }
    setPending(true);
    try {
      const client = getFlowClient();
      if (mock) {
        const result = await client.upload({ email, files: [], choice: selected });
        trackOrderUpload(result.orderId, pageCount);
        writeToken(result.orderToken);
        writeEmail(email);
        router.push("/quote");
        return;
      }
      if (picked.length === 0) {
        setError("Add at least one PDF or photo.");
        return;
      }
      const result = await client.upload({ email, files: picked, choice: selected });
      trackOrderUpload(result.orderId, pageCount);
      writeToken(result.orderToken);
      writeEmail(email);
      rememberUpload(result.orderToken, picked);
      router.push(`/order/${encodeURIComponent(result.orderToken)}`);
    } catch (cause) {
      const message =
        cause instanceof FlowApiError
          ? cause.message
          : "We couldn't upload those files.";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flow-card-shadow rounded-[var(--cp-radius)] border border-line bg-bg p-5 md:p-[26px]">
      {intro ? (
        <>
          <h2 className="text-xl font-bold tracking-[-0.6px]">{intro.title}</h2>
          <p className="mt-1.5 mb-[18px] text-[13.5px] text-ink-muted">{intro.lede}</p>
        </>
      ) : null}
      <form onSubmit={onSubmit}>
        <fieldset data-testid="order-choice" className="mb-4">
          <legend className="mb-1.5 text-[13px] font-semibold">What do you need?</legend>
          <div className="grid gap-2">
            {PRODUCTS.map((item) => {
              const selected = product === item.id;
              return (
                <label
                  key={item.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-[var(--cp-radius)] border px-3 py-2.5 ${
                    selected ? "border-primary bg-[var(--cp-blue-l)]" : "border-line bg-bg"
                  }`}
                >
                  <input
                    type="radio"
                    name="product"
                    value={item.id}
                    checked={selected}
                    data-testid={`choice-${item.id}`}
                    onChange={() => setProduct(item.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold">{item.label}</span>
                    <span className="block text-[12.5px] text-ink-muted">{item.price}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {product === "translation" ? null : (
          <label className="mb-4 block">
            <span className="mb-1.5 block text-[13px] font-semibold">Degrees</span>
            <input
              data-testid="degree-count"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              required
              value={degrees}
              onChange={(event) => setDegrees(event.target.value)}
              className={fieldClass}
            />
            <span className="mt-1.5 block text-xs text-ink-muted">
              {TRANSLATION_ADDON} Staff sign off before the report is released.
            </span>
          </label>
        )}
        <div
          data-testid="upload-drop"
          className="rounded-[var(--cp-radius)] border-[1.5px] border-dashed border-[#b9c3d6] bg-[var(--cp-blue-l)] px-4 py-6 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            takeFiles(event.dataTransfer.files);
          }}
        >
          <div className="text-[26px] leading-none text-primary" aria-hidden>
            ⤒
          </div>
          <div className="mt-1.5 font-semibold">
            Drop files or{" "}
            <button
              type="button"
              className="cursor-pointer text-primary"
              onClick={() => inputRef.current?.click()}
            >
              browse
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            PDF, JPG, PNG, HEIC · several files OK
          </p>
          <input
            ref={inputRef}
            data-testid="file-input"
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            className="sr-only"
            onChange={(event) => takeFiles(event.target.files)}
          />
        </div>
        {files.length > 0 ? (
          <ul
            data-testid="file-list"
            className="mt-3 overflow-hidden rounded-[var(--cp-radius)] border border-line text-[13.5px]"
          >
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 first:border-t-0"
              >
                <span className="min-w-0 truncate">
                  <span aria-hidden>{file.kind === "pdf" ? "📄" : "🖼"} </span>
                  {file.name}
                </span>
                <span className="shrink-0 text-ink-muted">
                  {file.pages == null ? "Added" : pageLabel(file.pages)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold">
            Email for your preview link
          </span>
          <input
            data-testid="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[var(--cp-warn)]">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          data-testid="get-quote"
          disabled={pending}
          className={buttonClasses("primary", "mt-4 h-[50px] w-full text-[15px] disabled:opacity-60")}
        >
          {pending ? "Uploading…" : "Get my quote"}
        </button>
        <p className="mt-2.5 text-center text-xs text-ink-muted">
          <span aria-hidden>🔒 </span>
          Files are private and encrypted. Deleted on request.
        </p>
      </form>
    </div>
  );
}
