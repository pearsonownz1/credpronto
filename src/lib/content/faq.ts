import {
  COURSE_BY_COURSE_DETAIL,
  COURSE_BY_COURSE_PRICE_LABEL,
  DIPLOMA_DETAIL,
  DIPLOMA_PRICE_LABEL,
  TRANSLATION_ADDON,
  TRANSLATION_PAGE_LABEL,
} from "@/lib/evaluations/catalog";
import { SITE_ORIGIN } from "@/lib/seo";

export const FAQ_CANONICAL = `${SITE_ORIGIN}/faq`;
export const GUIDES_CANONICAL = `${SITE_ORIGIN}/guides`;

export type FaqItem = {
  question: string;
  answer: string;
};

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is a certified translation?",
    answer:
      "A certified translation is a complete English translation of a foreign-language document, plus a certification statement that the translation is accurate and complete. CredPronto includes that statement with the finished PDF.",
  },
  {
    question: "How much does a certified translation cost?",
    answer: `Certified translations start at ${TRANSLATION_PAGE_LABEL}. You see the price before you pay, and you can preview the finished translation free.`,
  },
  {
    question: "Can I preview a translation before I pay?",
    answer:
      "Yes. Upload a PDF or phone photos, read the translation, and pay only if it is right.",
  },
  {
    question: "What is a diploma evaluation?",
    answer: `A diploma evaluation is ${DIPLOMA_PRICE_LABEL} and states the ${DIPLOMA_DETAIL}. You pay that flat fee, then a credential evaluator signs the report before CredPronto releases it.`,
  },
  {
    question: "What is a course-by-course evaluation?",
    answer: `Course-by-course is ${COURSE_BY_COURSE_PRICE_LABEL}. ${COURSE_BY_COURSE_DETAIL} You pay that flat fee. Staff sign off before the report is released.`,
  },
  {
    question: "Does an evaluation include a translation?",
    answer: TRANSLATION_ADDON,
  },
];

export function faqPageJsonLd(items: readonly FaqItem[] = FAQ_ITEMS) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function faqJsonLdScript(items: readonly FaqItem[] = FAQ_ITEMS): string {
  return JSON.stringify(faqPageJsonLd(items)).replace(/</g, "\\u003c");
}
