import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export function Forbidden() {
  return (
    <main data-testid="forbidden" className="preview-theme flex min-h-dvh flex-col items-center justify-center bg-[#f6f7f9] px-6 text-center text-ink">
      <Wordmark />
      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted">403</p>
      <h1 className="mt-2 text-[26px] tracking-[-0.6px]">You don&apos;t have access to admin</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        This area is for staff and accounts with the admin flag. Your orders are still on the dashboard.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex h-10 items-center rounded-[var(--cp-radius)] bg-primary px-4 text-sm font-semibold text-white"
      >
        Back to your orders
      </Link>
    </main>
  );
}
