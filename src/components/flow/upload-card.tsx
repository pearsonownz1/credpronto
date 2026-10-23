"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  SERVICE_IDS,
  checksAfterToggle,
  uploadChoiceFromChecks,
  type ServiceChecks,
  type UploadChoice,
} from "@/lib/flow/order-choice";
import type { FlowTrack } from "@/lib/flow/types";
import {
  adoptUploadInputs,
  checksAfterServiceChange,
  draftHasStoredFiles,
  readStoredFiles,
  serviceKeyFrom,
  uploadStateFromDraft,
  writeUploadDraft,
} from "./upload-draft";
import { formatMoney } from "@/lib/flow/pricing";
import { clampDegreeCount, uploadServiceQuote } from "@/lib/flow/upload-quote";
import { CUSTOMER_FILE_ACCEPT, addUploadFiles } from "@/lib/flow/uploads";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_ADDON,
} from "@/lib/evaluations/catalog";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import type { EvaluationService } from "@/lib/orders/types";
import { buttonClasses } from "./ui";
import { useQuoteUpload } from "./use-quote-upload";

type ListedFile = {
  id: string;
  name: string;
  kind: "pdf" | "image";
};

const SAMPLE_FILES: ListedFile[] = sampleCustomerOrder().documents.map((document) => ({
  id: document.id,
  name: document.filename,
  kind: document.filename.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
}));

/** Rate only. Billable pages are counted on the server after it reads the document. */
const TRANSLATION_RATE_NOTE = `${formatMoney(UNIT_PRICE_CENTS)} per page · exact price after we read your document`;

const PRODUCTS: Array<{
  id: "translation" | EvaluationService;
  key: keyof ServiceChecks;
  label: string;
  price: string;
}> = [
  { id: SERVICE_IDS.translation, key: "translation", label: "Translation", price: TRANSLATION_RATE_NOTE },
  { id: SERVICE_IDS.diploma, key: "diploma", label: "Diploma evaluation", price: DIPLOMA_PRICE_LABEL },
  {
    id: SERVICE_IDS.courseByCourse,
    key: "courseByCourse",
    label: "Course-by-course",
    price: COURSE_BY_COURSE_PRICE_LABEL,
  },
];

function DegreeStepper({ count, onChange }: { count: number; onChange: (next: number) => void }) {
  function setCount(next: number) {
    onChange(clampDegreeCount(next));
  }

  return (
    <div data-testid="degree-count" role="group" aria-labelledby="degrees-label" className="flex items-center gap-1.5">
      <span id="degrees-label" className="text-[12.5px] font-semibold">
        Degrees
      </span>
      <button
        type="button"
        data-testid="degree-decrease"
        aria-label="Decrease degrees"
        disabled={count <= 1}
        onClick={() => setCount(count - 1)}
        className="inline-flex size-7 items-center justify-center rounded-[var(--cp-radius)] border border-line bg-bg text-[16px] leading-none text-ink disabled:opacity-40"
      >
        −
      </button>
      <span data-testid="degree-value" aria-live="polite" aria-atomic="true" className="min-w-4 text-center text-[14px] font-semibold tabular-nums">
        {count}
      </span>
      <button
        type="button"
        data-testid="degree-increase"
        aria-label="Increase degrees"
        disabled={count >= 5}
        onClick={() => setCount(count + 1)}
        className="inline-flex size-7 items-center justify-center rounded-[var(--cp-radius)] border border-line bg-bg text-[16px] leading-none text-ink disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

function readDomChecks(form: HTMLFormElement): ServiceChecks | null {
  const translation = form.querySelector<HTMLInputElement>('[data-testid="choice-translation"]');
  const diploma = form.querySelector<HTMLInputElement>('[data-testid="choice-diploma"]');
  const course = form.querySelector<HTMLInputElement>('[data-testid="choice-course_by_course"]');
  if (!translation || !diploma || !course) return null;
  return {
    translation: translation.checked,
    diploma: diploma.checked,
    courseByCourse: course.checked,
  };
}

function useQuoteEmail(serverEmail: string | null | undefined): string | null {
  const seeded = serverEmail?.trim() || null;
  const [browserEmail, setBrowserEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const next = data.user?.email?.trim() || "";
        if (!cancelled && next) setBrowserEmail(next);
      } catch {
        // Auth is not configured in this environment. Keep the server email.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return browserEmail ?? seeded;
}

export function UploadCard({
  intro,
  initialService,
  sessionEmail,
  onTrackChange,
}: {
  intro?: { title: string; lede: string };
  initialService?: string | null;
  sessionEmail?: string | null;
  onTrackChange?: (track: FlowTrack) => void;
}) {
  const { mock, pending, error, setError, submit } = useQuoteUpload();
  const signedInEmail = useQuoteEmail(sessionEmail);
  const inputRef = useRef<HTMLInputElement>(null);
  const [start] = useState(() => uploadStateFromDraft(initialService));
  const [picked, setPicked] = useState<File[]>(start.files);
  const [checks, setChecks] = useState<ServiceChecks>(start.checks);
  const [degrees, setDegrees] = useState(() => String(clampDegreeCount(Number(start.degrees))));
  const seenService = useRef(start.serviceKey);
  const restoreFiles = useRef(start.files.length === 0 && draftHasStoredFiles());

  useEffect(() => {
    if (!restoreFiles.current) return;
    let cancelled = false;
    void readStoredFiles().then((files) => {
      if (cancelled || files.length === 0) return;
      setPicked((current) => (current.length > 0 ? current : files));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const form = inputRef.current?.form ?? null;
    const domChecks = form ? readDomChecks(form) : null;
    const adopted = adoptUploadInputs(
      { email: "", files: picked, checks },
      {
        email: "",
        files: inputRef.current?.files ? Array.from(inputRef.current.files) : [],
        checks: domChecks,
      },
    );
    if (picked.length === 0 && adopted.files.length > 0) setPicked(adopted.files);
    if (adopted.checks !== checks) setChecks(adopted.checks);
    // Adopt the DOM once, before the first toggle can render empty React state over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const serviceKey = serviceKeyFrom(initialService);
    if (seenService.current === serviceKey) return;
    const previous = seenService.current;
    seenService.current = serviceKey;
    setChecks((current) => checksAfterServiceChange(current, previous, serviceKey));
  }, [initialService]);

  useEffect(() => {
    writeUploadDraft({
      email: "",
      files: picked,
      checks,
      degrees,
      serviceKey: seenService.current,
    });
  }, [picked, checks, degrees]);

  useEffect(() => {
    const evaluation = checks.diploma || checks.courseByCourse;
    onTrackChange?.(evaluation && checks.translation ? "bundle" : evaluation ? "evaluation" : "translation");
  }, [checks.diploma, checks.courseByCourse, checks.translation, onTrackChange]);

  const files: ListedFile[] =
    mock && picked.length === 0
      ? SAMPLE_FILES
      : picked.map((file) => ({
          id: `${file.name}-${file.size}`,
          name: file.name,
          kind: file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image",
        }));
  const quote = uploadServiceQuote({
    checks,
    degreeCount: clampDegreeCount(Number(degrees)),
  });

  function takeFiles(list: FileList | null) {
    if (!list || list.length === 0 || mock) return;
    const incoming = Array.from(list);
    setPicked((current) => addUploadFiles(current, incoming));
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFile(index: number) {
    setPicked((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function choice(): UploadChoice | null {
    return uploadChoiceFromChecks(checks, quote.degreeCount);
  }

  function choiceError(): string {
    if (!checks.translation && !checks.diploma && !checks.courseByCourse) {
      return "Choose any combination.";
    }
    return "Enter at least 1 degree.";
  }

  function toggleCheck(key: keyof ServiceChecks, checked: boolean) {
    setChecks((current) => checksAfterToggle(current, key, checked));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = choice();
    if (!selected) {
      setError(choiceError());
      return;
    }
    if (!mock && picked.length === 0) {
      setError("Add at least one PDF or photo.");
      return;
    }
    await submit({
      files: picked,
      choice: selected,
      pageCount: null,
      signedIn: Boolean(signedInEmail),
    });
  }

  return (
    <div className="flow-card-shadow rounded-[var(--cp-radius)] border border-line bg-bg p-5 md:p-[26px]">
      {intro ? (
        <>
          <h2 className="text-xl font-bold tracking-[-0.6px]">{intro.title}</h2>
          <p className="mt-1.5 mb-[18px] text-[13.5px] text-ink-muted">{intro.lede}</p>
        </>
      ) : null}
      <form noValidate onSubmit={onSubmit}>
        <fieldset data-testid="order-choice" className="mb-4">
          <legend className="text-[13px] font-semibold">What do you need?</legend>
          <p className="mt-1 mb-2 text-xs text-ink-muted">Choose any combination.</p>
          <div className="grid gap-2">
            {PRODUCTS.map((item) => {
              const selected = checks[item.key];
              const fixedCents =
                item.id === SERVICE_IDS.diploma
                  ? quote.diplomaCents
                  : item.id === SERVICE_IDS.courseByCourse
                    ? quote.courseCents
                    : null;
              const showDegrees = selected && item.id !== SERVICE_IDS.translation;
              const price =
                item.id === SERVICE_IDS.translation ? null : selected && fixedCents != null ? formatMoney(fixedCents) : item.price;
              return (
                <div
                  key={item.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--cp-radius)] border px-3 py-2.5 ${
                    selected ? "border-primary bg-[var(--cp-blue-l)]" : "border-line bg-bg"
                  }`}
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <span className="service-check-box">
                      <input
                        type="checkbox"
                        className="service-check"
                        value={item.id}
                        checked={selected}
                        data-testid={`choice-${item.id}`}
                        onChange={(event) => toggleCheck(item.key, event.target.checked)}
                      />
                      <svg className="service-check-mark" viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          fill="currentColor"
                          fillRule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold">{item.label}</span>
                      <span className="block text-[12.5px] text-ink-muted">{item.price}</span>
                    </span>
                  </label>
                  {showDegrees ? (
                    <DegreeStepper count={quote.degreeCount} onChange={(next) => setDegrees(String(next))} />
                  ) : null}
                  {price != null ? (
                    <span data-testid={`choice-price-${item.id}`} className="ml-auto shrink-0 text-[14px] font-semibold tabular-nums">
                      {price}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p data-testid="choice-total" className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[14px] font-semibold">
            <span>Total</span>
            <span data-testid="choice-total-amount" className="tabular-nums">
              {`From ${formatMoney(quote.fromCents)}`}
            </span>
          </p>
          {checks.diploma || checks.courseByCourse ? (
            <p className="mt-2 text-xs text-ink-muted">
              {checks.translation ? null : <>{TRANSLATION_ADDON} </>}
              Staff sign off before the report is released.
            </p>
          ) : null}
        </fieldset>
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
            accept={CUSTOMER_FILE_ACCEPT}
            className="sr-only"
            onChange={(event) => takeFiles(event.target.files)}
          />
        </div>
        {files.length > 0 ? (
          <ul
            data-testid="file-list"
            className="mt-3 overflow-hidden rounded-[var(--cp-radius)] border border-line text-[13.5px]"
          >
            {files.map((file, index) => {
              const removable = !(mock && picked.length === 0);
              return (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 first:border-t-0"
                >
                  <span className="min-w-0 truncate">
                    <span aria-hidden>{file.kind === "pdf" ? "📄" : "🖼"} </span>
                    {file.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-ink-muted">Added</span>
                    {removable ? (
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => removeFile(index)}
                        className="text-[13px] font-semibold text-ink-muted"
                      >
                        Remove
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {signedInEmail ? (
          <p data-testid="preview-email" className="mt-4 text-[13px] text-ink-muted">
            {(checks.diploma || checks.courseByCourse) && !checks.translation
              ? "Order updates go to"
              : "Preview link goes to"}{" "}
            {signedInEmail}
          </p>
        ) : null}
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
          {pending
            ? "Uploading…"
            : (checks.diploma || checks.courseByCourse) && !checks.translation
              ? "Continue to payment"
              : "Get my quote"}
        </button>
        <p className="mt-2.5 text-center text-xs text-ink-muted">
          <span aria-hidden>🔒 </span>
          Files are private and encrypted. Deleted on request.
        </p>
      </form>
    </div>
  );
}
