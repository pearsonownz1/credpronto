"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { signOut } from "@/lib/account/actions";
import { initials, previewWaiting } from "@/lib/account/present";
import type { Account } from "@/lib/account/names";
import type { CustomerOrder } from "@/lib/api/types";
import { Wordmark } from "@/components/wordmark";

type ShellContextValue = {
  account: Account;
  orders: CustomerOrder[];
  ordersError: string | null;
  now: number;
  query: string;
  setQuery: (value: string) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function useAccountShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useAccountShell must be used inside the dashboard");
  return value;
}

export function AccountShell({
  account,
  orders,
  ordersError,
  now,
  children,
}: {
  account: Account;
  orders: CustomerOrder[];
  ordersError: string | null;
  now: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQueryState] = useState("");
  const [open, setOpen] = useState(false);
  const waiting = previewWaiting(orders, now).length;

  function setQuery(value: string) {
    setQueryState(value);
    if (pathname !== "/dashboard") router.push("/dashboard");
  }

  return (
    <ShellContext.Provider value={{ account, orders, ordersError, now, query, setQuery }}>
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
            <Wordmark />
          </div>
          <label className="flex h-9 items-center justify-between rounded-[var(--cp-radius)] border border-line px-2.5 text-[13px] text-ink-muted">
            <span className="sr-only">Search orders</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search orders…"
              className="w-full bg-transparent outline-none placeholder:text-ink-muted"
            />
            <span className="font-mono text-[11px]">⌘K</span>
          </label>
          <p className="mx-2 mt-[22px] mb-1.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-muted">Account</p>
          <NavLink href="/dashboard" active={pathname === "/dashboard"} icon={<OrdersIcon />} onClick={() => setOpen(false)}>
            Orders
            {waiting > 0 ? (
              <span className="ml-auto rounded-[9px] bg-primary px-[7px] text-[11px] text-white">{waiting}</span>
            ) : null}
          </NavLink>
          <NavLink href="/dashboard/receipts" active={pathname === "/dashboard/receipts"} icon={<ReceiptsIcon />} onClick={() => setOpen(false)}>
            Receipts
          </NavLink>
          <NavLink
            href="/dashboard/integrations"
            active={pathname.startsWith("/dashboard/integrations")}
            icon={<KeyIcon />}
            testId="nav-integrations"
            onClick={() => setOpen(false)}
          >
            Integrations
          </NavLink>
          <NavLink href="/dashboard/settings" active={pathname === "/dashboard/settings"} icon={<SettingsIcon />} onClick={() => setOpen(false)}>
            Settings
          </NavLink>
          <p className="mx-2 mt-[22px] mb-1.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-muted">Services</p>
          <NavLink href="/translate" active={false} icon={<DocIcon />} onClick={() => setOpen(false)}>
            Certified translation
          </NavLink>
          <NavLink
            href="/evaluations"
            active={pathname === "/evaluations"}
            icon={<CapIcon />}
            testId="nav-evaluation"
            onClick={() => setOpen(false)}
          >
            Credential evaluation
          </NavLink>
          <div className="mt-auto border-t border-line pt-2">
            <AccountMenu account={account} />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden">
            <button type="button" data-testid="open-menu" className="text-sm font-semibold" onClick={() => setOpen(true)}>
              Menu
            </button>
            <Wordmark />
            <AccountMenu account={account} compact />
          </div>
          <div className="min-w-0 flex-1 px-4 py-6 md:px-9 md:py-7">{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

function AccountMenu({ account, compact = false }: { account: Account; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-testid={compact ? "mobile-account" : "sidebar-account"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-[13.5px]"
      >
        <span className="inline-flex size-[30px] items-center justify-center rounded-full bg-[#eaf0ff] text-xs font-bold text-primary">
          {initials(account.name)}
        </span>
        {compact ? null : (
          <span className="min-w-0">
            <span className="block truncate">{account.name}</span>
            <span className="block truncate text-xs text-ink-muted">{account.email}</span>
          </span>
        )}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 bottom-full z-20 mb-2 w-52 rounded-[var(--cp-radius)] border border-line bg-white p-1 text-sm shadow-sm md:left-0 md:right-auto">
          <div className="px-3 py-2 text-xs text-ink-muted md:hidden">
            <p className="font-semibold text-ink">{account.name}</p>
            <p className="truncate">{account.email}</p>
          </div>
          {account.isAdmin ? (
            <Link href="/admin" role="menuitem" className="block rounded-[3px] px-3 py-2 hover:bg-[#f6f7f9]">
              Admin
            </Link>
          ) : null}
          <form action={signOut}>
            <button type="submit" role="menuitem" className="block w-full rounded-[3px] px-3 py-2 text-left hover:bg-[#f6f7f9]">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function NavLink({
  href,
  active,
  icon,
  children,
  onClick,
  testId,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-[var(--cp-radius)] px-2.5 py-2 text-sm ${active ? "bg-[#eaf0ff] font-semibold text-primary" : "text-[#374151]"}`}
    >
      {icon}
      {children}
    </Link>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      {children}
    </svg>
  );
}

function OrdersIcon() {
  return (
    <Icon>
      <path d="M3 11l9-7 9 7v9H3z" />
    </Icon>
  );
}
function ReceiptsIcon() {
  return (
    <Icon>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </Icon>
  );
}
function KeyIcon() {
  return (
    <Icon>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M17 6l3 3" />
    </Icon>
  );
}
function SettingsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </Icon>
  );
}
function DocIcon() {
  return (
    <Icon>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M15 3v4h4M9 12h7M9 16h5" />
    </Icon>
  );
}
function CapIcon() {
  return (
    <Icon>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c3 2 9 2 12 0v-5" />
    </Icon>
  );
}
