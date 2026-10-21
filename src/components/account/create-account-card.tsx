"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useId, useState, type FormEvent, type ReactNode } from "react";
import { mockMagicLink, mockPasswordAuth } from "@/lib/account/actions";
import { browserJson, publicMockMode } from "@/lib/api/browser";
import { safeNextPath } from "@/lib/auth/redirect";

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
};

const inputClass =
  "h-11 w-full rounded-[4px] border border-[#E5E7EB] bg-white px-3 text-[15px] font-normal text-ink outline-none focus:border-[#1F5EFF]";

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
  const [passwordState, passwordAction, passwordPending] = useActionState(mockPasswordAuth, null);
  const [magicState, magicAction, magicPending] = useActionState(mockMagicLink, null);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  function emailProblem(): string | undefined {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email.";
    return undefined;
  }

  function problems(): FieldErrors {
    const nextErrors: FieldErrors = {};
    if (!name.trim()) nextErrors.name = "Enter your full name.";
    const emailError = emailProblem();
    if (emailError) nextErrors.email = emailError;
    if (password.length < 8) nextErrors.password = "Use 8 or more characters.";
    return nextErrors;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    const nextErrors = problems();
    setErrors(nextErrors);
    setNotice(null);
    if (nextErrors.name || nextErrors.email || nextErrors.password) {
      event.preventDefault();
      return;
    }
    if (publicMockMode()) return;
    event.preventDefault();
    setPending(true);
    const result = await browserJson<{ session?: boolean }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        email: email.trim(),
        password,
        name: name.trim(),
        mode: "sign-up",
        next,
      }),
    });
    setPending(false);
    if (!result.ok) {
      if (result.status === 409) {
        setErrors({ email: "An account with this email already exists." });
        return;
      }
      const message = result.error || "Could not create the account.";
      if (/password/i.test(message)) setErrors({ password: message });
      else setErrors({ email: message });
      return;
    }
    if (result.data.session === false) {
      setNotice("Check your email to confirm your account. Then sign in.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  function onMagic(event: FormEvent<HTMLFormElement>) {
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
  const serverError = passwordState?.error ?? null;
  const serverField: FieldErrors = {};
  if (serverError) {
    if (/password/i.test(serverError)) serverField.password = serverError;
    else if (/name/i.test(serverError)) serverField.name = serverError;
    else serverField.email = serverError;
  }
  const emailError = errors.email || magicError || serverField.email;
  const magicNotice = magicError ? null : (notice ?? magicState?.message ?? null);

  return (
    <div
      data-testid="create-account-card"
      className="w-full max-w-[440px] rounded-[4px] border border-[#E5E7EB] bg-white p-8 text-ink"
    >
      <h1 className="text-[24px] font-semibold tracking-[-0.4px]">Create your account</h1>
      <p className="mt-2 text-[15px] text-ink-muted">Track your order and download your files anytime.</p>
      <form action={publicMockMode() ? passwordAction : undefined} onSubmit={onSubmit} className="mt-6 grid gap-4">
        <input type="hidden" name="next" value={next} />
        <Field id={nameId} label="Full name" error={errors.name || serverField.name}>
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
        <Field id={passwordId} label="Password" hint="8+ characters" error={errors.password || serverField.password}>
          <span className="relative block">
            <input
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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
      {magicNotice ? (
        <p role="status" className="mt-2 text-center text-[13px] text-ink-muted">
          {magicNotice}
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
