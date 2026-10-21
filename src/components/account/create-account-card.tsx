"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useId, useState, type FormEvent, type ReactNode } from "react";
import { mockMagicLink, mockPasswordAuth } from "@/lib/account/actions";
import { browserJson, publicMockMode } from "@/lib/api/browser";
import { continueAfterSignup, safeNextPath } from "@/lib/auth/redirect";
import { readToken } from "@/lib/flow/session";

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
};

const inputClass =
  "h-11 w-full rounded-[4px] border border-[#E5E7EB] bg-white px-3 text-[15px] font-normal text-ink outline-none focus:border-[#1F5EFF]";

const PASSWORD_LENGTH_ERROR = "Use 8 or more characters.";

/** Length hint, unless a server error is showing in its place. */
export function passwordLine(
  length: number,
  submittedShort: boolean,
  serverError?: string | null,
): "muted" | "good" | "short" | "server" {
  if (serverError) return "server";
  if (length >= 8) return "good";
  if (submittedShort) return "short";
  return "muted";
}

export function CreateAccountCard() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"), "/translate");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [submittedShort, setSubmittedShort] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [magicSubmitted, setMagicSubmitted] = useState(false);
  const [passwordState, passwordAction, passwordPending] = useActionState(mockPasswordAuth, null);
  const [magicState, magicAction, magicPending] = useActionState(mockMagicLink, null);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  function emailProblem(value = email): string | undefined {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return "Enter a valid email.";
    return undefined;
  }

  function problems(submittedName: string, submittedEmail: string, submittedPassword: string): FieldErrors {
    const nextErrors: FieldErrors = {};
    if (!submittedName.trim()) nextErrors.name = "Enter your full name.";
    const emailError = emailProblem(submittedEmail);
    if (emailError) nextErrors.email = emailError;
    if (submittedPassword.length < 8) nextErrors.password = PASSWORD_LENGTH_ERROR;
    return nextErrors;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const submittedName = formText(data, "name");
    const submittedEmail = formText(data, "email");
    const submittedPassword = passwordFromForm(data);
    setName(submittedName);
    setEmail(submittedEmail);
    setPassword(submittedPassword);
    setFormSubmitted(true);
    setSubmittedShort(submittedPassword.length < 8);
    setAuthError(null);
    const nextErrors = problems(submittedName, submittedEmail, submittedPassword);
    setErrors(nextErrors);
    setNotice(null);
    if (nextErrors.name || nextErrors.email || nextErrors.password) {
      event.preventDefault();
      return;
    }
    if (publicMockMode()) return;
    event.preventDefault();
    setPending(true);
    const result = await browserJson<{ session?: boolean; next?: string }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        email: submittedEmail.trim(),
        password: submittedPassword,
        name: submittedName.trim(),
        mode: "sign-up",
        next,
        orderToken: readToken(),
      }),
    });
    setPending(false);
    if (!result.ok) {
      if (result.status === 409) {
        setErrors({ email: "An account with this email already exists." });
        return;
      }
      setErrors({});
      setAuthError(result.error || "Could not create the account.");
      return;
    }
    router.push(continueAfterSignup(result.data.next, next));
    router.refresh();
  }

  function onMagic(event: FormEvent<HTMLFormElement>) {
    setMagicSubmitted(true);
    const emailError = emailProblem();
    setNotice(null);
    if (emailError) {
      setErrors({ email: emailError });
      event.preventDefault();
      return;
    }
    setErrors({});
    if (publicMockMode()) return;
    event.preventDefault();
    void sendMagicLink();
  }

  async function sendMagicLink() {
    setPending(true);
    const result = await browserJson<{ sent: boolean }>("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), next }),
    });
    setPending(false);
    if (!result.ok) setErrors({ email: result.error || "Could not send the sign-in link." });
    else setNotice("Check your email for a sign-in link.");
  }

  const busy = pending || passwordPending || magicPending;
  const magicError = magicState?.error ?? null;
  const actionError = passwordState?.error ?? null;
  const serverField: FieldErrors = {};
  if (actionError && !/password/i.test(actionError)) {
    if (/name/i.test(actionError)) serverField.name = actionError;
    else serverField.email = actionError;
  }
  const shownServer = formSubmitted ? serverField : {};
  const emailError = errors.email || (magicSubmitted ? magicError : null) || shownServer.email;
  const statusMessage =
    (formSubmitted || magicSubmitted) && !magicError
      ? (notice ?? (magicSubmitted ? magicState?.message ?? null : null))
      : null;
  const passwordActionError =
    formSubmitted && actionError && /password/i.test(actionError) ? actionError : null;
  const serverError =
    submittedShort && password.length < 8 ? null : authError || passwordActionError;

  return (
    <div
      data-testid="create-account-card"
      className="w-full max-w-[440px] rounded-[4px] border border-[#E5E7EB] bg-white p-8 text-ink"
    >
      <h1 className="text-[24px] font-semibold tracking-[-0.4px]">Create your account</h1>
      <p className="mt-2 text-[15px] text-ink-muted">Track your order and download your files anytime.</p>
      <form action={publicMockMode() ? passwordAction : undefined} onSubmit={onSubmit} className="mt-6 grid gap-4">
        <input type="hidden" name="mode" value="sign-up" />
        <input type="hidden" name="next" value={next} />
        <Field id={nameId} label="Full name" error={errors.name || shownServer.name}>
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id={emailId} label="Email" error={emailError}>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id={passwordId} label="Password">
          <span className="relative block">
            <input
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setAuthError(null);
              }}
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((current) => !current)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-ink-muted"
            >
              <EyeIcon hidden={!showPassword} />
            </button>
          </span>
          <PasswordStatus
            password={password}
            submittedShort={submittedShort}
            serverError={serverError}
          />
        </Field>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-12 w-full items-center justify-center rounded-[4px] bg-[#1F5EFF] text-[15px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Working…" : "Create account & continue"}
        </button>
      </form>
      <form action={publicMockMode() ? magicAction : undefined} onSubmit={onMagic} className="mt-4">
        <input type="hidden" name="email" value={email.trim()} />
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          disabled={busy}
          className="mx-auto block w-fit bg-transparent p-0 text-center text-[14px] font-semibold text-[#1F5EFF] disabled:opacity-60"
        >
          Email me a sign-in link instead
        </button>
      </form>
      {statusMessage ? (
        <p role="status" className="mt-2 text-center text-[13px] text-ink-muted">
          {statusMessage}
        </p>
      ) : null}
      <div className="my-5 border-t border-[#E5E7EB]" />
      <p className="text-center text-[14px]">
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-[#1F5EFF]">
          Already have an account? Sign in
        </Link>
      </p>
    </div>
  );
}

function formText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/** Submitted password, unread from React state and never trimmed. */
export function passwordFromForm(formData: FormData): string {
  return formText(formData, "password");
}

function PasswordStatus({
  password,
  submittedShort,
  serverError,
}: {
  password: string;
  submittedShort: boolean;
  serverError?: string | null;
}) {
  const line = passwordLine(password.length, submittedShort, serverError);
  if (line === "server" && serverError) {
    return (
      <span role="alert" className="mt-1.5 block text-[13px] text-[#dc2626]">
        {serverError}
      </span>
    );
  }
  if (line === "good") {
    return (
      <span className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#1F5EFF]">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 8.5 6.2 12 13 4" />
        </svg>
        Looks good
      </span>
    );
  }
  if (line === "short") {
    return (
      <span role="alert" className="mt-1.5 block text-[13px] text-[#dc2626]">
        {PASSWORD_LENGTH_ERROR}
      </span>
    );
  }
  return <span className="mt-1.5 block text-[13px] text-ink-muted">8+ characters</span>;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="mt-1.5 block text-[13px] text-ink-muted">{hint}</span> : null}
      {error ? (
        <span role="alert" className="mt-1 block text-[13px] text-[#dc2626]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {hidden ? null : <path d="M4 4l16 16" />}
    </svg>
  );
}
