import type { ReactNode } from "react";

export function buttonClasses(
  variant: "primary" | "secondary",
  extra = "",
) {
  const base =
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[var(--cp-radius)] font-semibold";
  const tone =
    variant === "primary"
      ? "border border-transparent bg-primary text-white hover:bg-primary-hover"
      : "border border-line bg-bg text-ink hover:bg-bg-muted";
  return `${base} ${tone} ${extra}`;
}

export const fieldClass =
  "h-11 w-full rounded-[var(--cp-radius)] border border-line bg-bg px-3 text-[15px] text-ink outline-none focus:border-primary";

export function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold">
        {label}
        {optional ? (
          <span className="font-normal text-ink-muted"> Optional</span>
        ) : null}
      </span>
      {children}
      {hint ? (
        <span className="mt-1.5 block text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Summary({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--cp-radius)] border border-line bg-bg text-sm">
      {children}
    </div>
  );
}

export function SummaryRow({
  label,
  value,
  emphasize,
  valueClass,
  testId,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  valueClass?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center justify-between gap-4 border-t border-line px-4 py-3 first:border-t-0 ${emphasize ? "text-[17px] font-bold" : ""}`}
    >
      <span>{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

export function Checks({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2 text-[13.5px] text-ink-muted">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="font-bold text-[var(--cp-ok)]" aria-hidden>
            ✓
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function FlowColumns({
  children,
  columns = "md:grid-cols-[minmax(0,1fr)_380px]",
}: {
  children: ReactNode;
  columns?: string;
}) {
  return (
    <div
      className={`mx-auto grid w-full max-w-[1280px] items-start gap-8 px-4 py-8 md:gap-12 md:px-[120px] md:py-12 ${columns}`}
    >
      {children}
    </div>
  );
}
