import type { ReactNode } from "react";
import Link from "next/link";

export function PreviewShell({
  toolbar,
  children,
  status,
}: {
  toolbar?: ReactNode;
  children?: ReactNode;
  status?: string;
}) {
  return (
    <div
      data-testid="preview-shell"
      className="flex h-dvh flex-col overflow-hidden bg-bg text-ink"
    >
      <header className="flex h-14 shrink-0 items-center border-b border-line px-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          CredPronto
        </Link>
        <span className="ml-3 text-sm text-ink-muted">Preview</span>
      </header>
      <div className="flex h-12 shrink-0 items-center border-b border-line px-3">
        {toolbar ?? (
          <p className="text-sm text-ink-muted">{status ?? "Loading preview…"}</p>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        {children ?? (
          <>
            <div className="min-h-0 min-w-0 flex-1 bg-bg-muted" />
            <div className="hidden min-h-0 min-w-0 flex-1 border-l border-line bg-bg-muted md:block" />
          </>
        )}
      </div>
      <footer className="sticky bottom-0 z-20 flex h-16 shrink-0 items-center justify-end gap-3 border-t border-line bg-bg px-4">
        <button
          type="button"
          data-testid="flag-correction"
          className="inline-flex h-10 items-center rounded-[var(--cp-radius)] border border-line px-4 text-sm font-medium text-ink"
        >
          Flag a correction
        </button>
        <button
          type="button"
          data-testid="buy-download"
          className="inline-flex h-10 items-center rounded-[var(--cp-radius)] bg-primary px-4 text-sm font-medium text-primary-ink"
        >
          Buy &amp; download, $XX
        </button>
      </footer>
    </div>
  );
}
