"use client";

import { useRouter } from "next/navigation";
import { MarketingHeader } from "./flow-header";
import { UploadCard } from "./upload-card";
import { useFlowDraft } from "./use-flow-draft";

const STATS = [
  ["$0", "to see your preview"],
  ["~10 min", "typical preview time"],
  ["USCIS", "certification included"],
];

const HOW = [
  ["1 · Upload", "PDF or phone photos"],
  ["2 · Preview", "Side by side, free"],
  ["3 · Purchase", "Exact price up front"],
  ["4 · Download", "Certified PDF by email"],
];

export function LandingView() {
  const router = useRouter();
  const { draft, quote, save } = useFlowDraft();

  return (
    <div>
      <MarketingHeader />
      <main className="mx-auto grid w-full max-w-[1280px] items-start gap-10 px-4 py-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:px-16 md:pt-16">
        <div>
          <p className="preview-kicker blue">
            Certified translations · Preview before you pay
          </p>
          <h1 className="mt-[18px] text-[40px] leading-[1.05] font-bold tracking-[-1px] md:text-[64px] md:tracking-[-1.6px]">
            Your documents.
            <br />
            Ready, pronto.
          </h1>
          <p className="mt-5 max-w-[520px] text-[17px] leading-normal text-ink-muted md:text-[19px]">
            Certified translations from{" "}
            <b className="text-ink">$9.95/page</b>. Upload now, see the full
            translation in about 10 minutes, and only pay if it’s right.
          </p>
          <div className="mt-7 grid grid-cols-3 gap-3 text-[13px] text-ink-muted md:flex md:gap-7 md:text-sm">
            {STATS.map(([value, label]) => (
              <p key={value}>
                <b className="block text-lg font-bold text-ink md:text-[22px]">
                  {value}
                </b>
                {label}
              </p>
            ))}
          </div>
          <div className="mt-11 grid grid-cols-2 gap-4 border-t border-line pt-5 text-[13px] md:grid-cols-4 md:gap-[18px]">
            {HOW.map(([title, detail]) => (
              <div key={title}>
                <b>{title}</b>
                <div className="mt-1 text-ink-muted">{detail}</div>
              </div>
            ))}
          </div>
        </div>
        <UploadCard
          email={draft.email}
          files={quote.files}
          onEmail={(email) => save({ email })}
          onSubmit={() => router.push("/quote")}
          intro={{
            title: "Get your free preview",
            lede: "No account, no card.",
          }}
        />
      </main>
    </div>
  );
}
