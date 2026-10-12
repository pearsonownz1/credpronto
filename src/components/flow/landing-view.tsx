"use client";

import Link from "next/link";
import {
  COURSE_BY_COURSE_DETAIL,
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_DETAIL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_ADDON,
  TRANSLATION_PAGE_LABEL,
} from "@/lib/evaluations/catalog";
import { MarketingHeader } from "./flow-header";
import { UploadCard } from "./upload-card";

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

export function LandingView() {
  return (
    <div>
      <MarketingHeader section="translations" />
      <main className="mx-auto grid w-full max-w-[1280px] items-start gap-10 px-4 py-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:px-16 md:pt-16">
        <div>
          <p className="preview-kicker blue">
            Certified translations · Preview before you pay
          </p>
          <h1 className="mt-[18px] text-[40px] leading-[1.05] font-bold tracking-[-1px] md:text-[64px] md:tracking-[-1.6px]">
            Your documents.
            <br />
            Ready, pronto.
          </h1>
          <p className="mt-5 max-w-[520px] text-[17px] leading-normal text-ink-muted md:text-[19px]">
            Certified translations from{" "}
            <b className="text-ink">$9.95/page</b>. Upload now, see the full
            translation in about 10 minutes, and only pay if it’s right.
          </p>
          <div className="mt-7 grid grid-cols-3 gap-3 text-[13px] text-ink-muted md:flex md:gap-7 md:text-sm">
            {STATS.map(([value, label]) => (
              <p key={value}>
                <b className="block text-lg font-bold text-ink md:text-[22px]">
                  {value}
                </b>
                {label}
              </p>
            ))}
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
        <UploadCard
          intro={{
            title: "Get your free preview",
            lede: "No account, no card.",
          }}
        />
      </main>
      <section id="pricing" className="border-t border-line" aria-labelledby="pricing-heading">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-12 md:px-16">
          <p className="preview-kicker">Pricing</p>
          <h2 id="pricing-heading" className="mt-3 text-[32px] font-bold tracking-[-0.6px]">
            What you pay
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <article className="rounded-[var(--cp-radius)] border border-line p-5">
              <h3 className="font-bold">Certified translation</h3>
              <p className="mt-2 text-[28px] font-bold tracking-[-0.6px]">{TRANSLATION_PAGE_LABEL}</p>
              <p className="mt-2 text-[15px] text-ink-muted">
                Preview the full translation, then pay only if it’s right.
              </p>
            </article>
            <article data-testid="home-diploma-price" className="rounded-[var(--cp-radius)] border border-line p-5">
              <h3 className="font-bold">Diploma evaluation</h3>
              <p className="mt-2 text-[28px] font-bold tracking-[-0.6px]">{DIPLOMA_PRICE_LABEL}</p>
              <p className="mt-2 text-[15px] text-ink-muted">{DIPLOMA_DETAIL}.</p>
            </article>
            <article data-testid="home-course-price" className="rounded-[var(--cp-radius)] border border-line p-5">
              <h3 className="font-bold">Course-by-course</h3>
              <p className="mt-2 text-[28px] font-bold tracking-[-0.6px]">
                {COURSE_BY_COURSE_PRICE_LABEL}
              </p>
              <p className="mt-2 text-[15px] text-ink-muted">{COURSE_BY_COURSE_DETAIL}</p>
            </article>
          </div>
          <p className="mt-4 max-w-[720px] text-[15px] text-ink-muted">
            {TRANSLATION_ADDON}{" "}
            <Link href="/evaluations" className="font-semibold text-primary">
              See sample evaluation reports
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
