"use client";

import { signOut } from "@/lib/account/actions";
import { useAccountShell } from "@/components/account/account-shell";

export function SettingsPanel() {
  const { account } = useAccountShell();
  return (
    <section>
      <h1 className="text-[26px] tracking-[-0.6px]">Settings</h1>
      <p className="mt-2 text-sm text-ink-muted">Signed in as {account.email}</p>
      <form action={signOut} className="mt-6">
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-[var(--cp-radius)] border border-line px-4 text-sm font-semibold"
        >
          Sign out
        </button>
      </form>
    </section>
  );
}
