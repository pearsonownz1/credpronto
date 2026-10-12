import type { ReactNode } from "react";
import { Wordmark } from "@/components/wordmark";
import { statusLabel, type PreviewOrder } from "./preview-order";

export function PreviewShell({
  order,
  toolbar,
  children,
  rail,
  mobileBar,
  status,
  variant = "customer",
}: {
  order?: PreviewOrder;
  toolbar?: ReactNode;
  children?: ReactNode;
  rail?: ReactNode;
  mobileBar?: ReactNode;
  status?: string;
  variant?: "customer" | "staff";
}) {
  return (
    <div
      data-testid="preview-shell"
      className={`preview-theme flex flex-col bg-bg text-ink ${variant === "staff" ? "h-full min-h-[560px]" : "h-dvh"}`}
    >
      <header className="flex h-[54px] shrink-0 items-center justify-between gap-5 border-b border-line bg-bg px-4 md:h-[60px] md:justify-start md:px-6">
        <Wordmark className="md:text-[18px]" />
        {order ? (
          <>
            <p className="text-xs text-ink-muted md:hidden">{order.id}</p>
            <p className="hidden min-w-0 truncate text-[13px] text-ink-muted md:block">
              Order <span className="font-semibold text-ink">{order.id}</span>
              {" · "}
              {order.sourceLanguage} → {order.targetLanguage}
              {" · "}
              {order.filename}
            </p>
            <span className="hidden rounded-full bg-[#e8f6f0] px-[9px] py-1 text-xs font-semibold text-[var(--cp-ok)] md:inline">
              {statusLabel(order)}
            </span>
            {variant === "customer" ? (
              <div className="ml-auto hidden items-center gap-5 md:flex">
                <button type="button" className="text-[13px] text-ink-muted">
                  Add documents
                </button>
                <button type="button" className="text-[13px] text-ink-muted">
                  Help
                </button>
              </div>
            ) : (
              <span className="ml-auto" />
            )}
          </>
        ) : (
          <span className="text-sm text-ink-muted">Preview</span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-bg-muted">
          <div className="relative z-20 flex min-h-[52px] shrink-0 items-center border-b border-line bg-bg">
            {toolbar ?? (
              <p className="px-5 text-sm text-ink-muted">
                {status ?? "Loading preview…"}
              </p>
            )}
          </div>
          <div className="relative flex min-h-0 flex-1">
            {children ?? <div className="min-h-0 min-w-0 flex-1" />}
          </div>
        </div>
        {rail ? (
          <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-line bg-bg p-6 md:block">
            {rail}
          </aside>
        ) : null}
      </div>
      {mobileBar ? <div className="shrink-0 md:hidden">{mobileBar}</div> : null}
    </div>
  );
}
