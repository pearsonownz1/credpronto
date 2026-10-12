"use client";

import { useRef, useState, type FormEvent } from "react";
import { customerEmailError } from "@/lib/flow/customer-email";
import { CUSTOMER_FILE_ACCEPT, dedupeUploads } from "@/lib/flow/uploads";
import { buttonClasses, fieldClass } from "./ui";
import { useQuoteUpload } from "./use-quote-upload";

export function HeroUpload() {
  const { mock, pending, error, setError, submit } = useQuoteUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(mock ? "maria.ruiz@email.com" : "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  function takeFiles(list: FileList | null) {
    if (!list || mock) return;
    setPicked(dedupeUploads(Array.from(list)));
    setFileError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = customerEmailError(email);
    if (problem) {
      setEmailError(problem);
      setError(null);
      emailRef.current?.focus();
      return;
    }
    setEmailError(null);
    if (!mock && picked.length === 0) {
      setFileError("Add at least one PDF or photo.");
      return;
    }
    setFileError(null);
    await submit({
      email,
      files: picked,
      choice: { orderType: "translation" },
      pageCount: null,
    });
  }

  return (
    <form
      data-testid="hero-upload"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      className="mt-8 max-w-[520px] rounded-[var(--cp-radius)] border border-line bg-white p-4"
    >
      <div
        data-testid="hero-upload-drop"
        className={`rounded-[var(--cp-radius)] border-[1.5px] border-dashed px-4 py-5 text-center ${
          over ? "border-primary bg-[var(--cp-blue-l)]" : "border-[#b9c3d6] bg-[var(--cp-blue-l)]"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          takeFiles(event.dataTransfer.files);
        }}
      >
        <div className="text-[22px] leading-none text-primary" aria-hidden>
          ⤒
        </div>
        <div className="mt-1.5 font-semibold">
          Drop files or{" "}
          <button type="button" className="cursor-pointer text-primary" onClick={() => inputRef.current?.click()}>
            browse
          </button>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-muted">PDF, JPG, PNG, HEIC · several files OK</p>
        <input
          ref={inputRef}
          data-testid="hero-file-input"
          type="file"
          multiple
          accept={CUSTOMER_FILE_ACCEPT}
          className="sr-only"
          onChange={(event) => takeFiles(event.target.files)}
        />
      </div>
      {picked.length > 0 ? (
        <ul className="mt-3 text-[13.5px] text-ink">
          {picked.map((file) => (
            <li key={`${file.name}-${file.size}`} className="truncate">
              {file.name}
            </li>
          ))}
        </ul>
      ) : null}
      {fileError ? (
        <p role="alert" data-testid="hero-file-error" className="mt-3 text-sm text-[var(--cp-warn)]">
          {fileError}
        </p>
      ) : null}
      <label className="mt-4 block">
        <span className="mb-1.5 block text-[13px] font-semibold">Email for your preview link</span>
        <input
          ref={emailRef}
          data-testid="hero-email"
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "hero-email-error" : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            if (emailError) setEmailError(null);
          }}
          className={fieldClass}
        />
      </label>
      {emailError ? (
        <p id="hero-email-error" role="alert" data-testid="hero-email-error" className="mt-1.5 text-sm text-[var(--cp-warn)]">
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
        data-testid="hero-get-quote"
        disabled={pending}
        className={buttonClasses("primary", "mt-4 h-12 w-full text-base disabled:opacity-60")}
      >
        {pending ? "Uploading…" : "Get my quote"}
      </button>
    </form>
  );
}
