"use client";

import { useActionState, useState, type FormEvent } from "react";
import { mockMagicLink, mockPasswordAuth } from "@/lib/account/actions";
import { browserJson, publicMockMode } from "@/lib/api/browser";
import { customerEmailError } from "@/lib/flow/customer-email";
import { useStoredEmail } from "./use-order";

const fieldClass =
  "h-11 w-full rounded-[4px] border border-[#D5DBE7] bg-white px-3 text-[15px] text-ink outline-none focus:border-[#1F5EFF]";

export function OrderAccountCard({
  orderToken,
  initialEmail = "",
  onSignedIn,
}: {
  orderToken: string;
  initialEmail?: string;
  onSignedIn: () => void;
}) {
  const stored = useStoredEmail();
  const [email, setEmail] = useState(initialEmail || stored);
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-up");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mockState, mockPassword, mockPasswordPending] = useActionState(mockPasswordAuth, null);
  const [magicState, mockMagic, mockMagicPending] = useActionState(mockMagicLink, null);
  const shownError = error ?? mockState?.error ?? magicState?.error ?? null;
  const shownMessage = message ?? mockState?.message ?? magicState?.message ?? null;
  const busy = pending || mockPasswordPending || mockMagicPending;

  async function lookUp(value: string) {
    if (publicMockMode()) return;
    if (customerEmailError(value)) return;
    const result = await browserJson<{ exists: boolean }>("/api/auth/lookup", {
      method: "POST",
      body: JSON.stringify({ email: value }),
    });
    if (!result.ok) return;
    setMode(result.data.exists ? "sign-in" : "sign-up");
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    if (publicMockMode()) return;
    event.preventDefault();
    const problem = customerEmailError(email);
    if (problem) {
      setError(problem);
      return;
    }
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);
    setMessage(null);
    const result = await browserJson<{ session?: boolean }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        mode: mode === "sign-in" ? "sign-in" : "sign-up",
        next: "/dashboard",
        orderToken,
      }),
    });
    setPending(false);
    if (!result.ok) {
      if (result.status === 409) {
        setMode("sign-in");
        setMessage("Log in");
        return;
      }
      setError(result.error);
      return;
    }
    if (mode === "sign-in" || result.data.session) {
      onSignedIn();
      return;
    }
    setError("Could not sign in.");
  }

  function onMagicSubmit(event: FormEvent<HTMLFormElement>) {
    if (publicMockMode()) return;
    event.preventDefault();
    void sendMagicLink();
  }

  async function sendMagicLink() {
    if (publicMockMode()) return;
    const problem = customerEmailError(email);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    const result = await browserJson<{ sent: boolean }>("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, next: "/dashboard", orderToken }),
    });
    setPending(false);
    if (!result.ok) setError(result.error);
    else setMessage("Check your email for a sign-in link. It works on any device.");
  }

  return (
    <section data-testid="account-card" className="mt-4 rounded-[4px] border border-[#D5DBE7] bg-white p-4">
      <h2 className="text-[15px] font-semibold">Create your account to track your order</h2>
      <p className="mt-1 text-[13px] text-ink-muted">Use an email and password, or a magic link.</p>
      <form
        className="mt-3 grid gap-3"
        action={publicMockMode() ? mockPassword : undefined}
        onSubmit={onPassword}
      >
        <input type="hidden" name="next" value="/dashboard" />
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold">Email</span>
          <input
            data-testid="account-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => void lookUp(email)}
            className={fieldClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold">Password</span>
          <input
            data-testid="account-password"
            name="password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={8}
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 items-center justify-center rounded-[4px] bg-[#1F5EFF] text-[15px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "sign-in" ? "Log in" : "Create account"}
        </button>
      </form>
      <form action={publicMockMode() ? mockMagic : undefined} onSubmit={onMagicSubmit} className="mt-2">
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          data-testid="account-magic-link"
          disabled={busy}
          className="h-11 w-full rounded-[4px] border border-[#1F5EFF] bg-white text-[15px] font-semibold text-[#1F5EFF] disabled:opacity-60"
        >
          Email me a magic link
        </button>
      </form>
      {shownError ? (
        <p role="alert" className="mt-3 text-sm text-[#b45309]">
          {shownError}
        </p>
      ) : null}
      {shownMessage ? (
        <p role="status" className="mt-3 text-sm text-ink-muted">
          {shownMessage}
        </p>
      ) : null}
    </section>
  );
}
