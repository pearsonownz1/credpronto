import Link from "next/link";
import {
  COURSE_BY_COURSE_DETAIL,
  COURSE_BY_COURSE_OFFER,
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_DETAIL,
  DIPLOMA_OFFER,
  DIPLOMA_PRICE_LABEL,
  EVALUATION_STEPS,
  TRANSLATION_ADDON,
} from "@/lib/evaluations/catalog";
import { MarketingHeader } from "@/components/flow/marketing-header";
import { buttonClasses } from "@/components/flow/ui";
import { CourseSample } from "./course-sample";
import { DiplomaSample } from "./diploma-sample";
import { SampleFrame } from "./report-chrome";

const OFFERS = [
  {
    name: "Diploma evaluation",
    price: DIPLOMA_PRICE_LABEL,
    detail: DIPLOMA_DETAIL,
    testId: "diploma-price",
    href: "/translate?service=diploma",
  },
  {
    name: "Course-by-course",
    price: COURSE_BY_COURSE_PRICE_LABEL,
    detail: COURSE_BY_COURSE_DETAIL,
    testId: "course-price",
    href: "/translate?service=course_by_course",
  },
];

export function EvaluationsView() {
  return (
    <div>
      <MarketingHeader section="evaluations" />
      <main data-testid="evaluations-page">
        <section className="mx-auto grid w-full max-w-[1280px] items-start gap-10 px-4 py-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:px-16 md:pt-16">
          <div>
            <p className="preview-kicker blue">Credential evaluations</p>
            <h1 className="mt-[18px] text-[40px] leading-[1.05] font-bold tracking-[-1px] md:text-[56px] md:tracking-[-1.4px]">
              U.S. equivalency
              <br />
              for your degree.
            </h1>
            <p className="mt-5 max-w-[540px] text-[17px] leading-normal text-ink-muted md:text-[19px]">
              {DIPLOMA_OFFER} {COURSE_BY_COURSE_OFFER}
            </p>
            <p
              data-testid="translation-addon"
              className="mt-4 max-w-[540px] text-[15px] leading-normal text-ink-muted"
            >
              {TRANSLATION_ADDON}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/translate?service=diploma"
                className={buttonClasses("primary", "h-11 px-[18px] text-[15px]")}
              >
                Upload a diploma
              </Link>
              <Link
                href="/translate?service=course_by_course"
                className={buttonClasses("secondary", "h-11 px-[18px] text-[15px]")}
              >
                Upload a transcript
              </Link>
              <a href="#samples" className={buttonClasses("secondary", "h-11 px-[18px] text-[15px]")}>
                See sample reports
              </a>
            </div>
            <ol className="mt-11 grid grid-cols-2 gap-4 border-t border-line pt-5 text-[13px] md:grid-cols-4 md:gap-[18px]">
              {EVALUATION_STEPS.map((step) => (
                <li key={step.title}>
                  <b>{step.title}</b>
                  <div className="mt-1 text-ink-muted">{step.detail}</div>
                </li>
              ))}
            </ol>
          </div>
          <SampleFrame
            label="Sample diploma evaluation for María Fernanda Ruiz Delgado"
            testId="diploma-sample"
          >
            <DiplomaSample />
          </SampleFrame>
        </section>

        <section className="border-t border-line" aria-labelledby="evaluation-prices">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-12 md:px-16">
            <p className="preview-kicker">Pricing</p>
            <h2 id="evaluation-prices" className="mt-3 text-[32px] font-bold tracking-[-0.6px]">
              Per degree
            </h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {OFFERS.map((offer) => (
                <article
                  key={offer.name}
                  data-testid={offer.testId}
                  className="rounded-[var(--cp-radius)] border border-line bg-bg p-5"
                >
                  <h3 className="text-lg font-bold tracking-[-0.3px]">{offer.name}</h3>
                  <p className="mt-2 text-[28px] font-bold tracking-[-0.6px]">{offer.price}</p>
                  <p className="mt-2 text-[15px] text-ink-muted">{offer.detail}</p>
                  <Link href={offer.href} className="mt-4 inline-block text-sm font-semibold text-primary">
                    Upload for this evaluation
                  </Link>
                </article>
              ))}
            </div>
            <p className="mt-4 max-w-[640px] text-[15px] text-ink-muted">{TRANSLATION_ADDON}</p>
          </div>
        </section>

        <section id="samples" className="border-t border-line bg-bg-muted">
          <div className="mx-auto grid w-full max-w-[1280px] items-start gap-8 px-4 py-12 md:grid-cols-[0.8fr_1.2fr] md:px-16">
            <div>
              <p className="preview-kicker">Sample report</p>
              <h2 className="mt-3 text-[32px] font-bold tracking-[-0.6px]">
                Semester hours, grades, and a GPA.
              </h2>
              <p className="mt-3 text-[15px] leading-normal text-ink-muted">
                {COURSE_BY_COURSE_DETAIL} This sample is watermarked. It is not for official use. A
                credential evaluator signs the report before CredPronto releases it.
              </p>
              <p className="mt-3 text-[15px] text-ink-muted">{TRANSLATION_ADDON}</p>
            </div>
            <SampleFrame
              label="Sample course-by-course evaluation for María Fernanda Ruiz Delgado"
              testId="course-sample"
            >
              <CourseSample />
            </SampleFrame>
          </div>
        </section>
      </main>
    </div>
  );
}
