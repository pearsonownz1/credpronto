"use client";

import Link from "next/link";
import { useState } from "react";
import { signOut } from "@/lib/account/actions";
import { initials } from "@/lib/account/present";
import type { Account } from "@/lib/account/names";

export function HeaderAccountMenu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="header-account"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-[#eaf0ff] text-xs text-primary">
          {initials(account.name)}
        </span>
        <span className="max-w-40 truncate">{account.name}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-48 rounded-[var(--cp-radius)] border border-line bg-white p-1 text-sm shadow-sm"
        >
          <MenuLink href="/dashboard">Your orders</MenuLink>
          {account.isAdmin ? <MenuLink href="/admin">Admin</MenuLink> : null}
          <form action={signOut}>
            <button type="submit" role="menuitem" className="block w-full rounded-[3px] px-3 py-2 text-left hover:bg-bg-muted">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} role="menuitem" className="block rounded-[3px] px-3 py-2 hover:bg-bg-muted">
      {children}
    </Link>
  );
}
