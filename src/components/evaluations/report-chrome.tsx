import type { ReactNode } from "react";
import { Logo } from "@/components/flow/mark";
import { PREVIEW_WATERMARK } from "@/lib/orders/constants";

export function SampleFrame({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <figure className="report-frame overflow-hidden rounded-[var(--cp-radius)] border border-line bg-white">
      <div className="report-page" data-testid={testId}>
        {children}
      </div>
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}

export function ReportWatermark() {
  const line = Array.from({ length: 18 }, () => PREVIEW_WATERMARK).join("  ");
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute -top-[10%] -left-[30%] w-[160%] -rotate-[30deg] text-[20px] leading-[70px] font-bold text-[rgba(31,94,255,0.14)]">
        {Array.from({ length: 16 }, () => line).join(" ")}
      </div>
    </div>
  );
}

export function ReportPage({ children }: { children: ReactNode }) {
  return (
    <article className="relative box-border h-[1056px] w-[816px] overflow-hidden bg-white px-16 pt-14 text-[12.5px] text-ink">
      <ReportWatermark />
      <div className="relative">{children}</div>
    </article>
  );
}

export function ReportTop({
  reportId,
  kind,
  issued,
}: {
  reportId: string;
  kind: string;
  issued: string;
}) {
  return (
    <header className="flex items-start justify-between border-b-2 border-ink pb-3.5">
      <Logo />
      <p className="text-right text-[11px] leading-relaxed text-ink-muted">
        Report <span className="preview-mono tracking-[0.06em] uppercase">{reportId}</span>
        <br />
        {kind}
        <br />
        Issued {issued}
      </p>
    </header>
  );
}

export function ReportSignature({ reportId, page }: { reportId: string; page: string }) {
  return (
    <footer className="absolute right-16 bottom-[50px] left-16 flex items-end justify-between border-t border-line pt-3 text-[11px] text-ink-muted">
      <p>
        <b className="text-[12.5px] text-ink">[Evaluator signature]</b>
        <br />
        Credential Evaluator, CredPronto
      </p>
      <p className="text-right">
        Verify at credpronto.com/verify
        <br />
        <span className="preview-mono tracking-[0.06em] uppercase">{reportId}</span>
        {" · "}
        {page}
      </p>
    </footer>
  );
}

export function ReportFacts({
  title,
  rows,
}: {
  title: string;
  rows: readonly (readonly [string, string])[];
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-[var(--cp-radius)] border border-line">
      <h3 className="border-b border-line bg-bg-muted px-3.5 py-2 text-[11.5px] font-semibold tracking-[0.05em] uppercase">
        {title}
      </h3>
      <dl className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-4 gap-y-[7px] px-3.5 py-3">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className={label === "Name" || label === "Credential" ? "font-bold" : undefined}>
              {label === "Translation" ? <TranslationValue value={value} /> : value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TranslationValue({ value }: { value: string }) {
  const match = value.match(/^(.*?)(CP-\d+)$/);
  if (!match) return value;
  return (
    <>
      {match[1]}
      <span className="preview-mono tracking-[0.06em] uppercase">{match[2]}</span>
    </>
  );
}
