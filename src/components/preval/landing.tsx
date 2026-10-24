import Link from "next/link";
import { PRE_EVALUATION_PATH } from "@/lib/pre-evaluation/handoff";

const STEPS = [
  { title: "Upload", body: "Add a diploma or transcript." },
  { title: "Enter your email", body: "We send your preview there too." },
  { title: "See your PreVal", body: "Then order the official evaluation, ready in about 5 minutes." },
] as const;

export function PrevalLanding() {
  return (
    <main data-testid="preval-page">
      <section className="mx-auto flex w-full max-w-[1280px] flex-col items-center gap-10 px-4 py-12 md:flex-row md:gap-14 md:px-16 md:pt-[72px] md:pb-14">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold tracking-[0.14em] text-[#2160ff]">FREE INSTANT PREVAL</p>
          <h1 className="mt-3 mb-[18px] text-[34px] leading-[1.1] font-bold text-[#0f172a] md:text-[46px]">
            See your likely U.S. equivalent in about a minute.
          </h1>
          <p className="mb-7 max-w-[640px] text-[18px] leading-normal text-[#475569]">
            Upload a diploma or transcript. Our AI checks it against EDGE equivalency data and shows the likely U.S.
            degree, with a confidence level. No account needed.
          </p>
          <div className="rounded-[12px] border-2 border-dashed border-[#b9c7ee] bg-[#f6f8ff] px-7 py-7 text-center">
            <Link
              href={PRE_EVALUATION_PATH}
              data-testid="preval-upload"
              className="inline-block rounded-[8px] bg-[#2160ff] px-7 py-[15px] text-[16px] font-bold text-white hover:bg-[#1a4fd6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2160ff]"
            >
              Upload diploma or transcript
            </Link>
            <p className="m-0 mt-3 text-[13px] text-[#64748b]">PDF, JPG or PNG, up to 10 MB</p>
          </div>
        </div>
        <aside className="w-full shrink-0 md:w-[470px]" aria-label="Example PreVal result">
          <div className="relative overflow-hidden rounded-[10px] border border-[#dfe3ea] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.10)]">
            <div
              aria-hidden
              data-testid="preval-watermark"
              className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center select-none"
            >
              <span className="rotate-[-30deg] text-[54px] font-extrabold tracking-[0.2em] text-[rgba(33,96,255,0.09)]">
                PREVIEW
              </span>
            </div>
            <div className="relative z-10 px-7 pt-7">
              <p className="text-[11px] tracking-[0.12em] text-[#64748b]">LIKELY U.S. EQUIVALENT</p>
              <p className="mt-1.5 mb-4 text-[19px] font-bold text-[#0f172a]">
                <span data-testid="preval-example" className="mb-1 block text-[13px] font-bold text-[#2160ff]">
                  Example
                </span>
                Bachelor of Science in Engineering
              </p>
              <span className="inline-block rounded-full bg-[#e7f7ee] px-2.5 py-[5px] text-[12px] font-bold text-[#137a3f]">
                High confidence
              </span>
            </div>
            <div className="relative z-10 mt-4 bg-[#0f172a] px-4 py-[9px] text-center text-[11px] tracking-[0.12em] text-white">
              PREVIEW ONLY · OFFICIAL EVALUATION REQUIRED
            </div>
          </div>
        </aside>
      </section>
      <section aria-label="How PreVal works" className="mx-auto grid w-full max-w-[1280px] gap-6 px-4 pt-2 pb-16 md:grid-cols-3 md:px-16">
        {STEPS.map((step, index) => (
          <article key={step.title} className="rounded-[10px] border border-[#eef1f5] p-6">
            <div
              aria-hidden
              className="flex size-[30px] items-center justify-center rounded-full bg-[#2160ff] text-[15px] font-bold text-white"
            >
              {index + 1}
            </div>
            <h2 className="mt-3.5 mb-1.5 text-[17px] font-bold text-[#0f172a]">{step.title}</h2>
            <p className="m-0 text-[14px] leading-normal text-[#64748b]">{step.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
