"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { signOut } from "@/lib/account/actions";
import { initials } from "@/lib/account/present";
import type { Account } from "@/lib/account/names";
import { Wordmark } from "@/components/wordmark";
import { ADMIN_NAV } from "./nav";

export function AdminShell({ account, children }: { account: Account; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="preview-theme flex min-h-dvh bg-[#f6f7f9] text-ink">
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-[#0b1220]/30 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`${open ? "fixed inset-y-0 left-0 z-40 flex" : "hidden"} w-60 shrink-0 flex-col border-r border-line bg-white px-3.5 py-5 md:static md:flex`}
      >
        <div className="px-2 pb-[18px]">
          <Wordmark href="/admin" />
        </div>
        <p className="mx-2 mb-1.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-muted">Staff</p>
        <nav className="grid gap-0.5">
          {ADMIN_NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`rounded-[var(--cp-radius)] px-2.5 py-2 text-sm ${active ? "bg-[#eaf0ff] font-semibold text-primary" : "text-[#374151]"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-line pt-3 md:block">
          <p className="px-2 text-[13.5px]">{account.name}</p>
          <p className="truncate px-2 text-xs text-ink-muted">{account.email}</p>
          <form action={signOut} className="mt-2">
            <button type="submit" className="px-2 text-sm font-semibold text-ink-muted">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden">
          <button type="button" data-testid="open-menu" className="text-sm font-semibold" onClick={() => setOpen(true)}>
            Menu
          </button>
          <Wordmark href="/admin" />
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-[#eaf0ff] text-xs font-bold text-primary">
            {initials(account.name)}
          </span>
        </div>
        <div className="min-w-0 flex-1 px-4 py-6 md:px-9 md:py-7">{children}</div>
      </div>
    </div>
  );
}
