import Link from "next/link";
import {
  COURSE_BY_COURSE_DETAIL,
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_DETAIL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_ADDON,
  TRANSLATION_PAGE_LABEL,
} from "@/lib/evaluations/catalog";
import { HomeSections } from "@/components/content/approved-sections";
import { HomeHero } from "./home-hero";
import { MarketingHeader } from "./marketing-header";

export function LandingView() {
  return (
    <div>
      <MarketingHeader section="translations" />
      <HomeHero />
      <HomeSections />
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
