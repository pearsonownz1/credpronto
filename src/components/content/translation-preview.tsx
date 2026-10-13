import { TranslationWatermark } from "@/components/preview/translation-watermark";

const ORIGINAL = [
  ["Document", "Acta de nacimiento"],
  ["Nombre", "María Fernanda Ruiz Delgado"],
  ["Fecha de nacimiento", "14 de marzo de 1994"],
  ["Lugar", "Guadalajara, Jalisco"],
];

const TRANSLATION = [
  ["Document", "Birth certificate"],
  ["Name", "María Fernanda Ruiz Delgado"],
  ["Date of birth", "14 March 1994"],
  ["Place", "Guadalajara, Jalisco"],
];

function Sheet({
  kicker,
  rows,
}: {
  kicker: string;
  rows: string[][];
}) {
  return (
    <div className="min-w-0 rounded-[4px] border border-[#e6e9f0] bg-white p-3 shadow-[0_16px_40px_-24px_rgba(11,18,32,0.45)] md:p-4">
      <p className="preview-kicker">{kicker}</p>
      <div className="mt-3 grid gap-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.04em] text-ink-muted uppercase">{label}</p>
            <p className="text-[12px] leading-snug font-semibold break-words text-ink md:text-[13px]">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end" aria-hidden>
        <div className="flex size-11 items-center justify-center rounded-full border-2 border-primary/30 text-center text-[8px] leading-tight font-bold tracking-[0.04em] text-primary/70 uppercase">
          {kicker === "Original" ? "Sello" : "Cert."}
        </div>
      </div>
    </div>
  );
}

export function TranslationPreview() {
  return (
    <figure
      data-testid="translation-preview"
      aria-label="Side-by-side preview of an original document and its English translation"
      className="relative overflow-hidden rounded-[4px] border border-[#e1e8ff] bg-[linear-gradient(160deg,#eef3ff,#f7f9fc)] p-4 md:p-6"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 md:gap-3">
        <Sheet kicker="Original" rows={ORIGINAL} />
        <div className="flex items-center text-primary" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M5 12h14" strokeLinecap="round" />
            <path d="M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <Sheet kicker="Translation" rows={TRANSLATION} />
      </div>
      <TranslationWatermark />
      <p className="pointer-events-none absolute top-3 right-3 z-20 rounded-[4px] border border-primary/25 bg-white px-2 py-1 text-[11px] font-bold tracking-[0.16em] text-primary">
        PREVIEW
      </p>
      <figcaption className="relative z-20 mt-3 text-[12px] font-semibold text-ink-muted">
        Example data · watermarked preview, not for official use
      </figcaption>
    </figure>
  );
}
