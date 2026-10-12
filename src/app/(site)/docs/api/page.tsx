import type { Metadata } from "next";
import { ContentShell } from "@/components/content/content-page";
import { QUICK_START_CODE_CLASS, integrationSamples } from "@/lib/integrations/present";
import { API_DOCS_CANONICAL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "API · CredPronto",
  description: "Create an API key, place a certified translation order, and download the finished files.",
  alternates: { canonical: API_DOCS_CANONICAL },
};

export default function ApiDocsPage() {
  return (
    <ContentShell>
      <p className="preview-kicker blue">Developers</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">API</h1>
      <p className="mt-4 text-[17px] leading-normal text-ink-muted">
        Sign in and open Integrations to create a key. The full key is shown once. Send it as{" "}
        <span className="font-mono text-[15px]">Authorization: Bearer</span> on the order routes below. A test key can
        place orders. A live key can place orders when live payments are on.
      </p>
      <div className="mt-10 grid min-w-0 gap-8">
        {integrationSamples(null).map((sample) => (
          <section key={sample.id} className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight">{sample.title}</h2>
            <pre className={`mt-3 ${QUICK_START_CODE_CLASS}`}>{sample.code}</pre>
          </section>
        ))}
      </div>
    </ContentShell>
  );
}
