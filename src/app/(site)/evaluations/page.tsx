import type { Metadata } from "next";
import { EvaluationsView } from "@/components/evaluations/evaluations-view";
import { jsonLdScript } from "@/lib/content/jsonld";
import { evaluationsFaqJsonLd, evaluationsPage } from "@/lib/content/marketing";

export const metadata: Metadata = {
  title: evaluationsPage.title,
  description: evaluationsPage.description,
  alternates: {
    canonical: evaluationsPage.canonical,
  },
};

export default function EvaluationsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(evaluationsFaqJsonLd()) }}
      />
      <EvaluationsView />
    </>
  );
}
