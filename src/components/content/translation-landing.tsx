import Link from "next/link";
import { ADDON_CATALOG, addonUnitPhrase } from "@/lib/orders/addons";
import { UNIT_PRICE_CENTS } from "@/lib/orders/constants";
import { formatMoney } from "@/lib/flow/pricing";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_ADDON,
  TRANSLATION_PAGE_LABEL,
} from "@/lib/evaluations/catalog";
import { homePage } from "@/lib/content/marketing";
import {
  faqOf,
  listOf,
  marketingSections,
  paragraphsOf,
  sectionByHeading,
} from "@/lib/content/marketing-sections";
import {
  Band,
  CtaBand,
  DocIcon,
  EyeIcon,
  FaqList,
  MailIcon,
  PrimaryLink,
  RichText,
  SectionHeading,
  ShieldIcon,
  StepStrip,
} from "./marketing-ui";
import { TranslationPreview } from "./translation-preview";

const HERO_HEADING = "Certified translations accepted by USCIS, and you see them first";

const TRUST = [
  { title: "USCIS accepted", detail: "Certification included with every order", icon: ShieldIcon },
  { title: "Preview before you pay", detail: "Read the full translation first", icon: EyeIcon },
  { title: "Certified PDF by email", detail: "Unlocked when you pay", icon: MailIcon },
];

const INCLUDE_LABELS = ["Full translation", "Certification", "Certified PDF"];

function addonAmount(id: "notarization" | "mail") {
  const item = ADDON_CATALOG.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing addon ${id}`);
  return `${formatMoney(item.unitCents)} ${addonUnitPhrase(item.per)}`;
}

const PRICES: { service: string; price: string; href?: string; testId?: string }[] = [
  { service: "Certified translation", price: `${formatMoney(UNIT_PRICE_CENTS)} per page` },
  { service: "Notarization (optional)", price: addonAmount("notarization") },
  { service: "Mailed hard copy (optional)", price: addonAmount("mail") },
  {
    service: "Diploma evaluation",
    price: DIPLOMA_PRICE_LABEL,
    href: "/evaluations",
    testId: "home-diploma-price",
  },
  {
    service: "Course-by-course evaluation",
    price: COURSE_BY_COURSE_PRICE_LABEL,
    href: "/evaluations",
    testId: "home-course-price",
  },
];

export function TranslationLanding() {
  const sections = marketingSections(homePage.body);
  const hero = sectionByHeading(sections, HERO_HEADING);
  const intro =
    paragraphsOf(hero).find((paragraph) => paragraph !== "Every paid order includes:") ?? "";
  const includes = listOf(hero, false);
  const steps = listOf(sectionByHeading(sections, "How it works"), true);
  const documents = sectionByHeading(sections, "Documents we translate");
  const audiences = sectionByHeading(sections, "Who uses CredPronto");
  const pricing = sectionByHeading(sections, "Clear pricing");
  const pricingNote = paragraphsOf(pricing).find((paragraph) => !paragraph.startsWith("|")) ?? "";
  const faq = faqOf(sectionByHeading(sections, "Frequently asked questions"));

  return (
    <div data-testid="home-approved">
      <section className="bg-white" aria-labelledby="translation-hero">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-10 px-4 py-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-14 md:px-16 md:py-20">
          <div>
            <p className="preview-kicker blue">Certified translation</p>
            <h1
              id="translation-hero"
              className="mt-4 max-w-[640px] text-[34px] leading-[1.08] font-bold tracking-[-0.9px] md:text-[48px] md:tracking-[-1.2px]"
            >
              {hero.heading}
            </h1>
            <div className="mt-5 max-w-[540px] text-[17px] leading-relaxed text-ink-muted md:text-[18px]">
              <RichText source={intro} />
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
              <PrimaryLink href="/translate" testId="home-get-started">
                Get started
              </PrimaryLink>
              <p>
                <span className="block text-[13px] font-semibold text-ink-muted">Certified translation</span>
                <span className="text-[28px] font-bold tracking-[-0.6px] text-ink">{TRANSLATION_PAGE_LABEL}</span>
              </p>
            </div>
          </div>
          <TranslationPreview />
        </div>
      </section>

      <section aria-label="Why people use CredPronto" className="border-y border-[#e1e8ff] bg-[#f3f6ff]">
        <ul className="mx-auto grid w-full max-w-[1280px] gap-6 px-4 py-6 md:grid-cols-3 md:px-16 md:py-7">
          {TRUST.map((item) => (
            <li key={item.title} className="flex items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[4px] bg-white text-primary">
                <item.icon />
              </span>
              <span>
                <span className="block text-[15px] font-bold">{item.title}</span>
                <span className="block text-[13px] text-ink-muted">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Band tone="white" labelledBy="how-it-works">
        <SectionHeading id="how-it-works">How it works</SectionHeading>
        <StepStrip items={steps} />
      </Band>

      <Band tone="muted" labelledBy="every-order">
        <SectionHeading id="every-order" kicker="Included">
          Every paid order includes
        </SectionHeading>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {includes.map((item, index) => (
            <li key={item.text} className="rounded-[4px] border border-[#e1e8ff] bg-white p-6">
              <span className="inline-flex size-10 items-center justify-center rounded-[4px] bg-[#eef3ff] text-primary">
                {index === 1 ? <ShieldIcon /> : index === 2 ? <MailIcon /> : <DocIcon />}
              </span>
              <h3 className="mt-4 text-[18px] font-bold tracking-[-0.2px]">
                {INCLUDE_LABELS[index] ?? "Included"}
              </h3>
              <div className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                <RichText source={item.text} />
              </div>
            </li>
          ))}
        </ul>
      </Band>

      <Band tone="white" labelledBy="documents">
        <SectionHeading id="documents">Documents we translate</SectionHeading>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {listOf(documents, false).map((item) => (
            <li
              key={item.text}
              className="flex items-start gap-3 rounded-[4px] border border-line bg-white px-4 py-3 text-[15px]"
            >
              <span className="mt-0.5 text-primary">
                <DocIcon />
              </span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        {paragraphsOf(documents).map((paragraph) => (
          <div key={paragraph} className="mt-6 max-w-[720px] text-[15px] leading-relaxed text-ink-muted">
            <RichText source={paragraph} />
          </div>
        ))}
      </Band>

      <Band tone="muted" labelledBy="who-uses">
        <SectionHeading id="who-uses">Who uses CredPronto</SectionHeading>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {listOf(audiences, false).map((item) => (
            <li key={item.lead ?? item.text} className="rounded-[4px] border border-[#e1e8ff] bg-white p-6">
              <h3 className="text-[18px] font-bold tracking-[-0.2px]">{item.lead}</h3>
              {item.text ? (
                <div className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                  <RichText source={item.text} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Band>

      <Band id="pricing" tone="white" labelledBy="pricing-heading">
        <SectionHeading id="pricing-heading" kicker="Pricing">
          Clear pricing
        </SectionHeading>
        <div className="mt-8 overflow-hidden rounded-[4px] border border-line">
          {PRICES.map((row) => (
            <div
              key={row.service}
              data-testid={row.testId}
              className="flex flex-col gap-1 border-t border-line px-4 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
            >
              <h3 className="text-[16px] font-semibold">{row.service}</h3>
              <p className="text-[16px] font-bold tracking-[-0.2px] sm:text-right">{row.price}</p>
            </div>
          ))}
        </div>
        {pricingNote ? (
          <div className="mt-4 max-w-[720px] text-[15px] leading-relaxed text-ink-muted">
            <RichText source={pricingNote} />
          </div>
        ) : null}
        <p className="mt-3 max-w-[720px] text-[15px] leading-relaxed text-ink-muted">
          {TRANSLATION_ADDON}{" "}
          <Link href="/evaluations" className="font-semibold text-primary underline decoration-primary/30 underline-offset-2">
            See sample evaluation reports
          </Link>
          .
        </p>
      </Band>

      <Band tone="muted" labelledBy="faq-heading">
        <SectionHeading id="faq-heading">Frequently asked questions</SectionHeading>
        <FaqList items={faq} name="translation-faq" />
      </Band>

      <CtaBand
        title="See the translation before you pay."
        body={`Upload your document and read the full translation next to the original. Certified translation is ${TRANSLATION_PAGE_LABEL}.`}
        actions={
          <PrimaryLink href="/translate" testId="home-closing-cta">
            Get started
          </PrimaryLink>
        }
      />
    </div>
  );
}
