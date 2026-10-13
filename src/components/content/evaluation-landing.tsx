import Link from "next/link";
import {
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_PRICE_LABEL,
} from "@/lib/evaluations/catalog";
import { evaluationsPage } from "@/lib/content/marketing";
import {
  faqOf,
  leadParagraph,
  listOf,
  marketingSections,
  paragraphsOf,
  sectionByHeading,
} from "@/lib/content/marketing-sections";
import {
  Band,
  CtaBand,
  DocIcon,
  FaqList,
  PrimaryLink,
  RichText,
  SecondaryLink,
  SectionHeading,
  StepStrip,
} from "./marketing-ui";

function priceFor(lead: string) {
  const name = lead.toLowerCase();
  if (name.includes("course-by-course")) return COURSE_BY_COURSE_PRICE_LABEL;
  if (name.includes("diploma")) return DIPLOMA_PRICE_LABEL;
  return null;
}

function offerHref(lead: string) {
  return lead.toLowerCase().includes("course-by-course")
    ? "/translate?service=course_by_course"
    : "/translate?service=diploma";
}

export function EvaluationLanding() {
  const sections = marketingSections(evaluationsPage.body);
  const intro = sectionByHeading(sections, "What a credential evaluation is");
  const which = sectionByHeading(sections, "Which evaluation do you need?");
  const offers = paragraphsOf(which)
    .map((paragraph) => {
      const lead = leadParagraph(paragraph);
      return lead ? { ...lead, price: priceFor(lead.lead) } : null;
    })
    .filter((offer): offer is NonNullable<typeof offer> => offer !== null);
  const whichNote = paragraphsOf(which).find((paragraph) => !paragraph.startsWith("**"));
  const uses = sectionByHeading(sections, "Common uses");
  const upload = sectionByHeading(sections, "What to upload");
  const steps = listOf(sectionByHeading(sections, "How it works"), true);
  const faq = faqOf(sectionByHeading(sections, "Frequently asked questions"));

  return (
    <div data-testid="evaluations-approved">
      <Band tone="white" labelledBy="what-evaluation">
        <SectionHeading id="what-evaluation">What a credential evaluation is</SectionHeading>
        <div className="mt-5 max-w-[720px] text-[17px] leading-relaxed text-ink-muted">
          {paragraphsOf(intro).map((paragraph) => (
            <RichText key={paragraph} source={paragraph} />
          ))}
        </div>
      </Band>

      <Band tone="muted" labelledBy="which-evaluation">
        <SectionHeading id="which-evaluation">Which evaluation do you need?</SectionHeading>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {offers.map((offer) => {
            const name = offer.lead.split(",")[0]?.trim() || offer.lead;
            return (
              <article key={offer.lead} className="flex flex-col rounded-[4px] border border-[#e1e8ff] bg-white p-6">
                <h3 className="text-[20px] font-bold tracking-[-0.3px]">{name}</h3>
                {offer.price ? (
                  <p className="mt-2 text-[28px] font-bold tracking-[-0.6px]">{offer.price}</p>
                ) : null}
                <div className="mt-3 text-[15px] leading-relaxed text-ink-muted">
                  <RichText source={offer.rest} />
                </div>
                <Link href={offerHref(offer.lead)} className="mt-5 text-sm font-semibold text-primary">
                  Upload for this evaluation
                </Link>
              </article>
            );
          })}
        </div>
        {whichNote ? (
          <div className="mt-5 max-w-[720px] text-[15px] leading-relaxed text-ink-muted">
            <RichText source={whichNote} />
          </div>
        ) : null}
      </Band>

      <Band tone="white" labelledBy="common-uses">
        <SectionHeading id="common-uses">Common uses</SectionHeading>
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {listOf(uses, false).map((item) => (
            <li key={item.lead ?? item.text} className="rounded-[4px] border border-line p-5">
              <h3 className="text-[17px] font-bold tracking-[-0.2px]">{item.lead}</h3>
              {item.text ? (
                <div className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                  <RichText source={item.text} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Band>

      <Band tone="muted" labelledBy="what-to-upload">
        <SectionHeading id="what-to-upload">What to upload</SectionHeading>
        <ul className="mt-8 grid max-w-[760px] gap-3">
          {listOf(upload, false).map((item) => (
            <li
              key={item.text}
              className="flex items-start gap-3 rounded-[4px] border border-[#e1e8ff] bg-white px-4 py-3 text-[15px] leading-relaxed"
            >
              <span className="mt-0.5 text-primary">
                <DocIcon />
              </span>
              <div>
                <RichText source={item.text} />
              </div>
            </li>
          ))}
        </ul>
      </Band>

      <Band tone="white" labelledBy="evaluation-steps">
        <SectionHeading id="evaluation-steps">How it works</SectionHeading>
        <StepStrip items={steps} />
      </Band>

      <Band tone="muted" labelledBy="evaluation-faq">
        <SectionHeading id="evaluation-faq">Frequently asked questions</SectionHeading>
        <FaqList items={faq} name="evaluation-faq" />
      </Band>

      <CtaBand
        title="Preview the report before you pay."
        body="Upload a diploma or transcript. You'll get a watermarked preview, and staff sign off before the final report is released."
        actions={
          <>
            <PrimaryLink href="/translate?service=diploma">Upload a diploma</PrimaryLink>
            <SecondaryLink href="/translate?service=course_by_course">Upload a transcript</SecondaryLink>
          </>
        }
      />
    </div>
  );
}
