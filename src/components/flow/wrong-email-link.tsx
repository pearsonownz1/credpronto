"use client";

import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import { changeAccountEmail } from "@/lib/auth/account-email";
import { createClient } from "@/lib/supabase/client";
import { buttonClasses, fieldClass } from "./ui";

type AccountEmailScopeValue = {
  email: string | null;
  setEmail: (email: string) => void;
};

const AccountEmailContext = createContext<AccountEmailScopeValue>({
  email: null,
  setEmail: () => undefined,
});

/** Signed-in address for screens that render after upload. */
export function AccountEmailScope({ email, children }: { email: string | null; children: ReactNode }) {
  const [current, setCurrent] = useState(email?.trim() || null);
  return (
    <AccountEmailContext.Provider value={{ email: current, setEmail: setCurrent }}>
      {children}
    </AccountEmailContext.Provider>
  );
}

export function useAccountEmail(): string | null {
  return useContext(AccountEmailContext).email;
}

export function WrongEmailLink({
  email,
  onConfirmed,
}: {
  email: string;
  onConfirmed?: (email: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await changeAccountEmail(async (attributes) => {
      const supabase = createClient();
      return supabase.auth.updateUser(attributes);
    }, email, draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.pendingConfirmation) {
      setNotice(result.message);
      setEditing(false);
      return;
    }
    onConfirmed?.(result.email);
    setEditing(false);
  }

  return (
    <div className="mt-2">
      {editing ? null : (
        <a
          href="#account-email"
          data-testid="fix-email"
          className="text-[13px] font-semibold text-primary"
          onClick={(event) => {
            event.preventDefault();
            setDraft(email);
            setError(null);
            setNotice(null);
            setEditing(true);
          }}
        >
          Wrong email? Fix it
        </a>
      )}
      {editing ? (
        <form noValidate className="mt-2 grid gap-2" onSubmit={save}>
          <label htmlFor="account-email" className="text-[13px] font-semibold">
            Account email
          </label>
          <input
            id="account-email"
            data-testid="account-email"
            type="email"
            autoComplete="email"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={fieldClass}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={buttonClasses("primary", "h-10 px-4 text-sm disabled:opacity-60")}
            >
              {busy ? "Saving…" : "Update email"}
            </button>
            <button
              type="button"
              className={buttonClasses("secondary", "h-10 px-4 text-sm")}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-[var(--cp-warn)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-1.5 text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/** Link under a signed-in address that this screen already shows. */
export function ScopedWrongEmailLink() {
  const { email, setEmail } = useContext(AccountEmailContext);
  if (!email) return null;
  return <WrongEmailLink email={email} onConfirmed={setEmail} />;
}
