"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { knownPageCount } from "@/lib/analytics/google-ads";
import { customerEmailError } from "@/lib/flow/customer-email";
import {
  uploadChoiceFromChecks,
  type ServiceChecks,
  type UploadChoice,
} from "@/lib/flow/order-choice";
import {
  adoptUploadInputs,
  checksAfterServiceChange,
  draftHasStoredFiles,
  readStoredFiles,
  serviceKeyFrom,
  uploadStateFromDraft,
  writeUploadDraft,
} from "./upload-draft";
import { pageLabel } from "@/lib/flow/pricing";
import { CUSTOMER_FILE_ACCEPT, dedupeUploads } from "@/lib/flow/uploads";
import { sampleCustomerOrder } from "@/lib/flow/sample-order";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_ADDON,
  TRANSLATION_PAGE_LABEL,
} from "@/lib/evaluations/catalog";
import type { EvaluationService } from "@/lib/orders/types";
import { buttonClasses, fieldClass } from "./ui";
import { useQuoteUpload } from "./use-quote-upload";

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
  key: keyof ServiceChecks;
  label: string;
  price: string;
}> = [
  { id: "translation", key: "translation", label: "Translation", price: TRANSLATION_PAGE_LABEL },
  { id: "diploma", key: "diploma", label: "Diploma evaluation", price: DIPLOMA_PRICE_LABEL },
  {
    id: "course_by_course",
    key: "courseByCourse",
    label: "Course-by-course",
    price: COURSE_BY_COURSE_PRICE_LABEL,
  },
];

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
  onEvaluationChange,
}: {
  intro?: { title: string; lede: string };
  initialService?: string | null;
  sessionEmail?: string | null;
  onEvaluationChange?: (evaluation: boolean) => void;
}) {
  const { mock, pending, error, setError, submit } = useQuoteUpload();
  const signedInEmail = useQuoteEmail(sessionEmail);
  const inputRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [start] = useState(() => uploadStateFromDraft(initialService));
  const [email, setEmail] = useState(start.email || (mock ? "maria.ruiz@email.com" : ""));
  const [emailError, setEmailError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File[]>(start.files);
  const [checks, setChecks] = useState<ServiceChecks>(start.checks);
  const [degrees, setDegrees] = useState(start.degrees);
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
      { email, files: picked, checks },
      {
        email: emailRef.current?.value ?? "",
        files: inputRef.current?.files ? Array.from(inputRef.current.files) : [],
        checks: domChecks,
      },
    );
    if (adopted.email !== email) setEmail(adopted.email);
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
      email,
      files: picked,
      checks,
      degrees,
      serviceKey: seenService.current,
    });
  }, [email, picked, checks, degrees]);

  useEffect(() => {
    onEvaluationChange?.(checks.diploma || checks.courseByCourse);
  }, [checks.diploma, checks.courseByCourse, onEvaluationChange]);
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
    return uploadChoiceFromChecks(checks, Number(degrees));
  }

  function choiceError(): string {
    if (!checks.translation && !checks.diploma && !checks.courseByCourse) {
      return "Choose a translation, an evaluation, or both.";
    }
    return "Enter at least 1 degree.";
  }

  function toggleCheck(key: keyof ServiceChecks, checked: boolean) {
    setChecks((current) => {
      const next = { ...current, [key]: checked };
      if (key === "diploma" && checked) next.courseByCourse = false;
      if (key === "courseByCourse" && checked) next.diploma = false;
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signedInEmail) {
      const problem = customerEmailError(email);
      if (problem) {
        setEmailError(problem);
        setError(null);
        emailRef.current?.focus();
        return;
      }
    }
    setEmailError(null);
    const selected = choice();
    if (!selected) {
      setError(choiceError());
      return;
    }
    if (!mock && picked.length === 0) {
      setError("Add at least one PDF or photo.");
      return;
    }
    await submit({ email: signedInEmail ?? email, files: picked, choice: selected, pageCount });
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
          <legend className="mb-1.5 text-[13px] font-semibold">What do you need?</legend>
          <div className="grid gap-2">
            {PRODUCTS.map((item) => {
              const selected = checks[item.key];
              return (
                <label
                  key={item.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-[var(--cp-radius)] border px-3 py-2.5 ${
                    selected ? "border-primary bg-[var(--cp-blue-l)]" : "border-line bg-bg"
                  }`}
                >
                  <input
                    type="checkbox"
                    value={item.id}
                    checked={selected}
                    data-testid={`choice-${item.id}`}
                    onChange={(event) => toggleCheck(item.key, event.target.checked)}
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
        {checks.diploma || checks.courseByCourse ? (
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
        ) : null}
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
        {signedInEmail ? (
          <p data-testid="preview-email" className="mt-4 text-[13px] text-ink-muted">
            {checks.diploma || checks.courseByCourse ? "Order updates go to" : "Preview link goes to"}{" "}
            {signedInEmail}
          </p>
        ) : (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[13px] font-semibold">
              {checks.diploma || checks.courseByCourse ? "Email for your order" : "Email for your preview link"}
            </span>
            <input
              ref={emailRef}
              data-testid="email"
              type="email"
              autoComplete="email"
              value={email}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error" : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailError) setEmailError(null);
              }}
              className={fieldClass}
            />
          </label>
        )}
        {emailError ? (
          <p id="email-error" role="alert" data-testid="email-error" className="mt-1.5 text-sm text-[var(--cp-warn)]">
            {emailError}
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
            : checks.diploma || checks.courseByCourse
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
