"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useState, type FormEvent } from "react";
import { mockMagicLink, mockPasswordAuth } from "@/lib/account/actions";
import { GOOGLE_UNAVAILABLE, messageForGoogleError } from "@/lib/account/present";
import { browserJson, publicMockMode } from "@/lib/api/browser";
import { safeNextPath } from "@/lib/auth/redirect";

type Mode = "sign-in" | "sign-up" | "forgot";

export function SignInCreateLink() {
  const params = useSearchParams();
  const next = params.get("next");
  const href = next ? `/sign-up?next=${encodeURIComponent(safeNextPath(next, "/translate"))}` : "/sign-up";
  return (
    <p className="text-center text-[14px]">
      <Link href={href} className="font-semibold text-[#1F5EFF]">
        New to CredPronto? Create an account
      </Link>
    </p>
  );
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"), "/dashboard");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googlePending, setGooglePending] = useState(false);
  const [mockState, mockAction, mockPending] = useActionState(
    mode === "forgot" ? mockMagicLink : mockPasswordAuth,
    null,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (publicMockMode()) return;
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (mode === "forgot") {
      const result = await browserJson<{ sent: boolean }>("/api/auth/magic-link", {
        method: "POST",
        body: JSON.stringify({ email, next }),
      });
      setPending(false);
      if (!result.ok) setError(result.error);
      else setMessage("Check your email for a sign-in link.");
      return;
    }
    const result = await browserJson<{ session?: boolean; userId?: string | null }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        mode: mode === "sign-up" ? "sign-up" : "sign-in",
        next,
      }),
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (mode === "sign-up" && result.data.session === false) {
      setMessage("Check your email to confirm your account. Then sign in.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function onGoogle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGoogleError(null);
    if (publicMockMode()) {
      setGoogleError(GOOGLE_UNAVAILABLE);
      return;
    }
    setGooglePending(true);
    const result = await browserJson<{ url: string }>("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ next }),
    });
    setGooglePending(false);
    if (!result.ok) {
      setGoogleError(messageForGoogleError(result.error));
      return;
    }
    if (!result.data.url) {
      setGoogleError(GOOGLE_UNAVAILABLE);
      return;
    }
    window.location.assign(result.data.url);
  }

  const shownError = error ?? mockState?.error ?? null;
  const shownMessage = message ?? mockState?.message ?? null;
  const busy = pending || mockPending;

  return (
    <div className="grid gap-4">
      {mode !== "forgot" ? (
        <form onSubmit={onGoogle}>
          <button
            type="submit"
            disabled={googlePending}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--cp-radius)] border border-line bg-white text-[15px] font-semibold text-ink disabled:opacity-60"
          >
            Continue with Google
          </button>
          {googleError ? (
            <p role="alert" className="mt-2 text-sm text-[#b45309]">
              {googleError}
            </p>
          ) : null}
        </form>
      ) : null}
      {mode !== "forgot" ? (
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">or use email</p>
      ) : null}
      <form action={publicMockMode() ? mockAction : undefined} onSubmit={onSubmit} className="grid gap-3">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        {mode !== "forgot" ? (
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={8}
          />
        ) : null}
        {shownError ? (
          <p role="alert" className="text-sm text-[#b45309]">
            {shownError}
          </p>
        ) : null}
        {shownMessage ? (
          <p role="status" className="text-sm text-[var(--cp-ok)]">
            {shownMessage}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 items-center justify-center rounded-[var(--cp-radius)] bg-primary text-[15px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Email me a sign-in link"}
        </button>
      </form>
      <p className="text-sm text-ink-muted">
        {mode === "sign-in" ? (
          <Link href="/forgot-password" className="font-semibold text-primary">
            Forgot password
          </Link>
        ) : null}
        {mode === "sign-up" ? (
          <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-primary">
            Already have an account? Sign in
          </Link>
        ) : null}
        {mode === "forgot" ? (
          <Link href="/sign-in" className="font-semibold text-primary">
            Back to sign in
          </Link>
        ) : null}
      </p>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className="h-11 rounded-[var(--cp-radius)] border border-line px-3 text-[15px] font-normal outline-none focus:border-primary"
      />
    </label>
  );
}
