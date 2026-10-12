"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { DIPLOMA_DETAIL, DIPLOMA_PRICE_LABEL } from "@/lib/evaluations/catalog";
import { buttonClasses } from "./ui";

const STATS = [
  ["$0", "to see your preview"],
  ["~10 min", "typical preview time"],
  ["USCIS", "certification included"],
];

const HOW = [
  ["1 · Upload", "PDF or phone photos"],
  ["2 · Preview", "Side by side, free"],
  ["3 · Purchase", "Exact price up front"],
  ["4 · Download", "Certified PDF by email"],
];

const SAMPLE_SRC = "/samples/cover-cert-sample.png";
const SAMPLE_ALT = "Sample certificate of translation accuracy. Example data, not a real certification.";

export function HomeHero() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section className="mx-auto grid w-full max-w-[1280px] items-center gap-10 px-4 py-10 md:grid-cols-[minmax(0,1fr)_520px] md:gap-10 md:px-16 md:pt-16">
      <div>
        <p className="preview-kicker blue">Certified translations · Preview before you pay</p>
        <h1 className="mt-[18px] text-[40px] leading-[1.05] font-bold tracking-[-1px] md:text-[58px] md:tracking-[-1.4px]">
          Your documents.
          <br />
          Ready, pronto.
        </h1>
        <p className="mt-5 max-w-[520px] text-[17px] leading-normal text-ink-muted md:text-[19px]">
          Certified translations from <b className="text-ink">$9.95/page</b>. Upload now, see the full
          translation in about 10 minutes, and only pay if it’s right.
        </p>
        <div className="mt-7 grid grid-cols-3 gap-3 text-[13px] text-ink-muted md:flex md:gap-7 md:text-sm">
          {STATS.map(([value, label]) => (
            <p key={value}>
              <b className="block text-lg font-bold text-ink md:text-[22px]">{value}</b>
              {label}
            </p>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Link
            href="/translate"
            data-testid="hero-get-started"
            className={buttonClasses("primary", "h-12 px-6 text-base")}
          >
            Get started
          </Link>
          <a
            href="#sample"
            data-testid="see-sample"
            onClick={() => setOpen(true)}
            className="text-base font-semibold text-primary"
          >
            See a sample →
          </a>
        </div>
        <p className="mt-6 max-w-[520px] text-[15px] text-ink-muted">
          <Link href="/evaluations" className="font-semibold text-primary">
            Credential evaluations
          </Link>{" "}
          start at {DIPLOMA_PRICE_LABEL}. {DIPLOMA_DETAIL}.
        </p>
        <div className="mt-11 grid grid-cols-2 gap-4 border-t border-line pt-5 text-[13px] md:grid-cols-4 md:gap-[18px]">
          {HOW.map(([title, detail]) => (
            <div key={title}>
              <b>{title}</b>
              <div className="mt-1 text-ink-muted">{detail}</div>
            </div>
          ))}
        </div>
      </div>
      <div
        id="sample"
        data-testid="sample-stage"
        className="relative aspect-[520/560] w-full overflow-hidden rounded-[4px] border border-[#e4e7ec] bg-[linear-gradient(160deg,#EEF3FF,#F7F9FC)]"
      >
        <div
          aria-hidden
          className="absolute top-[7.5%] left-[10%] h-[92.5%] w-[76.9%] rotate-[-2deg] rounded-[2px] border border-line bg-white shadow-[0_12px_30px_rgba(11,18,32,0.08)]"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute top-[6%] left-[11.9%] h-[92.5%] w-[76.9%] rotate-[3deg] cursor-pointer shadow-[0_24px_50px_rgba(11,18,32,0.18)]"
        >
          <Image
            src={SAMPLE_SRC}
            alt={SAMPLE_ALT}
            width={773}
            height={1000}
            data-testid="cover-sample"
            priority
            className="h-full w-full bg-white object-cover object-top"
          />
        </button>
        <p className="absolute top-[12%] right-3 z-10 rounded-[4px] border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink shadow-sm md:top-[150px]">
          ✓ Signed certification included
        </p>
        <p className="absolute bottom-[5%] left-[6%] z-10 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-muted">
          Sample certificate · example data
        </p>
      </div>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Sample certificate"
          data-testid="sample-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1220]/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="max-h-[92vh] max-w-[640px]" onClick={(event) => event.stopPropagation()}>
            <Image
              src={SAMPLE_SRC}
              alt={SAMPLE_ALT}
              width={773}
              height={1000}
              className="h-auto max-h-[86vh] w-auto rounded-[4px] bg-white shadow-[0_24px_50px_rgba(11,18,32,0.18)]"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 rounded-[4px] bg-white px-3 py-1.5 text-sm font-semibold text-ink"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
