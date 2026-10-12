"use client";

import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/flow/pricing";
import { FlowHeader } from "./flow-header";
import {
  Checks,
  Field,
  FlowColumns,
  Summary,
  SummaryRow,
  buttonClasses,
  fieldClass,
} from "./ui";
import { useFlowDraft } from "./use-flow-draft";

export function CheckoutView() {
  const router = useRouter();
  const { draft, quote, save } = useFlowDraft();

  return (
    <div>
      <FlowHeader current="preview" />
      <main>
        <FlowColumns columns="md:grid-cols-[minmax(0,1fr)_420px] md:gap-14">
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.6px]">
              Buy your certified translation
            </h1>
            <p className="mt-2 mb-6 text-[15px] text-ink-muted">
              You’ve reviewed it. Pay once and download right away.
            </p>
            <Field label="Email">
              <input
                data-testid="email"
                type="email"
                required
                autoComplete="email"
                value={draft.email}
                onChange={(event) => save({ email: event.target.value })}
                className={fieldClass}
              />
            </Field>
            <div className="mt-3.5">
              <span className="mb-1.5 block text-[13px] font-semibold">Card</span>
              <div className={`${fieldClass} flex items-center justify-between gap-3`}>
                <input
                  data-testid="card-number"
                  aria-label="Card number"
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue="4242 4242 4242 4242"
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
                <span className="shrink-0 text-[13px] text-ink-muted">
                  12 / 28 · 123
                </span>
              </div>
            </div>
            <div className="mt-3.5 grid grid-cols-3 gap-2.5">
              <button
                type="button"
                data-testid="wallet-apple"
                className={buttonClasses("secondary", "h-11 px-2 text-[13px]")}
              >
                Apple Pay
              </button>
              <button
                type="button"
                data-testid="wallet-google"
                className={buttonClasses("secondary", "h-11 px-2 text-[13px]")}
              >
                Google Pay
              </button>
              <button
                type="button"
                data-testid="wallet-link"
                className={buttonClasses("secondary", "h-11 px-2 text-[13px]")}
              >
                Link
              </button>
            </div>
            <button
              type="button"
              data-testid="pay-button"
              onClick={() => {
                save({ paid: true });
                router.push("/download");
              }}
              className={buttonClasses(
                "primary",
                "mt-[22px] h-[52px] w-full text-base",
              )}
            >
              Pay {formatMoney(quote.totalCents)} and download
            </button>
            <p className="mt-2.5 text-center text-xs text-ink-muted">
              <span aria-hidden>🔒 </span>
              Secure payment by Stripe
            </p>
          </div>
          <div>
            <div className="flex items-center gap-3.5 rounded-[var(--cp-radius)] border border-line p-[18px]">
              <div
                className="relative h-[74px] w-[58px] shrink-0 overflow-hidden border border-line bg-bg"
                aria-hidden
              >
                <div className="flow-lines absolute inset-2" />
              </div>
              <div className="text-sm">
                <b>Birth certificate</b>
                <div className="text-[13px] text-ink-muted">
                  {draft.sourceLanguage} → {draft.targetLanguage} · {quote.pages}{" "}
                  pages
                </div>
                <div className="mt-1 text-[12.5px] text-[var(--cp-ok)]">
                  ✓ Reviewed · 1 correction applied
                </div>
              </div>
            </div>
            <div className="mt-3.5">
              <Summary>
                <SummaryRow
                  label={`${quote.pages} pages × ${formatMoney(quote.perPageCents)}`}
                  value={formatMoney(quote.subtotalCents)}
                />
                <SummaryRow label="Certificate of accuracy" value="Included" />
                <SummaryRow
                  testId="order-total"
                  label="Total"
                  value={formatMoney(quote.totalCents)}
                  emphasize
                />
              </Summary>
            </div>
            <div className="mt-[18px]">
              <Checks
                items={[
                  "Clean PDF, no watermark",
                  "Signed certification page",
                  "Emailed and downloadable anytime",
                ]}
              />
            </div>
          </div>
        </FlowColumns>
      </main>
    </div>
  );
}
