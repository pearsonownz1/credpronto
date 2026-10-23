import type { Metadata } from "next";
import { connection } from "next/server";
import { clioNow } from "@/lib/clio/now";
import { clioStore } from "@/lib/clio/store";
import { serviceDb } from "@/lib/orders/storage";
import { ROBOTS_NOINDEX } from "@/lib/seo";

export const instant = false;

export const metadata: Metadata = {
  title: "Order a translation from Clio",
  robots: ROBOTS_NOINDEX,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClioTranslatePage({
  searchParams,
}: {
  searchParams: Promise<{ handoff?: string | string[]; error?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const handoffId = Array.isArray(params.handoff) ? params.handoff[0] : params.handoff;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  let documents: Array<{ id: string; name: string }> = [];
  let unavailable = false;
  let found = false;
  if (handoffId && UUID.test(handoffId)) {
    try {
      const handoff = await clioStore(serviceDb()).readHandoff(handoffId, clioNow());
      if (handoff) {
        found = true;
        documents = handoff.documents.map((document) => ({ id: document.id, name: document.name }));
      }
    } catch {
      unavailable = true;
    }
  }

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 py-10 md:py-16">
      <h1 className="text-[32px] font-bold tracking-[-0.6px]">Order a translation</h1>
      <p className="mt-2 mb-6 text-[15px] text-ink-muted">
        Choose the Clio documents to translate. This starts a certified translation and keeps the order linked to the matter.
      </p>
      {unavailable ? <p className="text-[15px] text-[#b42318]">Clio is not available right now.</p> : null}
      {!unavailable && error === "verify" ? (
        <p className="text-[15px] text-[#b42318]">Clio could not confirm that request. Open the matter and choose Order Translation again.</p>
      ) : null}
      {!unavailable && error === "download" ? (
        <p className="text-[15px] text-[#b42318]">Those documents could not be copied from Clio. Try again from the matter.</p>
      ) : null}
      {!unavailable && error === "expired" ? (
        <p className="text-[15px] text-[#b42318]">This Clio link expired. Open the matter and choose Order Translation again.</p>
      ) : null}
      {!unavailable && error === "choose" ? <p className="mb-4 text-[15px] text-[#b42318]">Choose at least one document.</p> : null}
      {!unavailable && found && documents.length === 0 ? (
        <p data-testid="clio-documents-empty" className="text-[15px] text-ink-muted">
          This matter has no PDF or photo we can translate.
        </p>
      ) : null}
      {!unavailable && found && documents.length > 0 && handoffId ? (
        <form method="post" action="/api/integrations/clio/actions/order-translation" className="grid gap-3" data-testid="clio-document-picker">
          <input type="hidden" name="handoff" value={handoffId} />
          <ul className="grid gap-2">
            {documents.map((document) => (
              <li key={document.id}>
                <label className="flex items-center gap-3 rounded-[var(--cp-radius)] border border-line bg-white px-3 py-3 text-[14px]">
                  <input type="checkbox" name="documentId" value={document.id} defaultChecked data-testid={`clio-document-${document.id}`} />
                  <span>{document.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            data-testid="clio-continue"
            className="inline-flex h-11 items-center justify-center rounded-[var(--cp-radius)] bg-primary px-4 text-[15px] font-semibold text-white"
          >
            Continue
          </button>
        </form>
      ) : null}
      {!unavailable && !found && !error ? (
        <p className="text-[15px] text-ink-muted">Open a matter in Clio and choose Order Translation.</p>
      ) : null}
    </main>
  );
}
