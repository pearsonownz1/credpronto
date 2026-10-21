import type { ReactNode } from "react";
import { Wordmark } from "@/components/wordmark";

export function AuthLayout({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="preview-theme flex min-h-dvh items-center justify-center bg-bg-muted px-4 py-12 text-ink">
      <div className="w-full max-w-[420px]">
        <Wordmark />
        <div className="mt-8 rounded-[var(--cp-radius)] border border-line bg-white p-6 shadow-[0_1px_2px_rgba(11,18,32,0.04)]">
          <h1 className="text-[26px] tracking-[-0.6px]">{title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{lede}</p>
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-4">{footer}</div> : null}
      </div>
    </main>
  );
}
