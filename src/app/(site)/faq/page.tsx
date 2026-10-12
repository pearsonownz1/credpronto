import type { Metadata } from "next";
import { ContentShell } from "@/components/content/content-page";
import { FAQ_CANONICAL, FAQ_ITEMS, faqJsonLdScript } from "@/lib/content/faq";

export const metadata: Metadata = {
  title: "FAQ · CredPronto",
  description:
    "Answers about certified translation, previews, diploma evaluations, and course-by-course evaluations.",
  alternates: { canonical: FAQ_CANONICAL },
};

export default function FaqPage() {
  return (
    <ContentShell>
      <p className="preview-kicker blue">Resources</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Frequently asked questions</h1>
      <p className="mt-4 text-[17px] leading-normal text-ink-muted">
        Certified translation and credential evaluations, including what you receive and what
        you pay.
      </p>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLdScript() }}
      />
      <div className="mt-10 grid gap-8">
        {FAQ_ITEMS.map((item) => (
          <section key={item.question} className="border-t border-line pt-6">
            <h2 className="text-xl font-bold tracking-tight">{item.question}</h2>
            <p className="mt-2 text-[16px] leading-relaxed text-ink-muted">{item.answer}</p>
          </section>
        ))}
      </div>
    </ContentShell>
  );
}
