import type { Metadata } from "next";
import { LandingView } from "@/components/flow/landing-view";
import { jsonLdScript } from "@/lib/content/jsonld";
import { homeFaqJsonLd, homePage, ORGANIZATION_JSON_LD } from "@/lib/content/marketing";

export const metadata: Metadata = {
  title: homePage.title,
  description: homePage.description,
  alternates: {
    canonical: homePage.canonical,
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(homeFaqJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(ORGANIZATION_JSON_LD) }}
      />
      <LandingView />
    </>
  );
}
