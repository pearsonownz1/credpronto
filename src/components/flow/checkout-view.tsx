"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { formatMoney } from "@/lib/flow/pricing";
import {
  checkoutFailureMessage,
  languageLine,
  totalLabel,
} from "@/lib/flow/present";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredEmail, useStoredToken } from "./use-order";
import { Checks, FlowColumns, Summary, SummaryRow, buttonClasses, fieldClass } from "./ui";

export function CheckoutView({ token: pathToken }: { token?: string }) {
  const token = useStoredToken(pathToken);
  const email = useStoredEmail();
  const router = useRouter();
  const { order, error, loading } = useCustomerOrder(token, "once");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const notReady = order != null && order.status !== "preview_ready";

  async function pay() {
    setPending(true);
    setNotice(null);
    try {
      const result = await getFlowClient().checkout(token);
      if ("url" in result && result.url) {
        window.location.assign(result.url);
        return;
      }
      if ("mode" in result && result.mode === "paid_test") {
        router.push(`/order/${encodeURIComponent(token)}?checkout=success`);
        return;
      }
      setNotice("Checkout did not return a payment link.");
    } catch (cause) {
      if (cause instanceof FlowApiError) {
        const waiting = checkoutFailureMessage(cause.status, cause.message);
        if (waiting) {
          setNotice(waiting);
          return;
        }
        if (cause.status === 409 && /already paid/i.test(cause.message)) {
          router.push(`/order/${encodeURIComponent(token)}?checkout=success`);
          return;
        }
        setNotice(cause.message);
        return;
      }
      setNotice("Payment could not start.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <FlowHeader current="preview" />
      <main>
        {loading && !order ? (
          <FlowStatus title="Loading checkout…" body="" />
        ) : error && !order ? (
          <FlowStatus title="We couldn't load this order" body={error} />
        ) : !order ? (
          <FlowStatus title="No order to pay for" body="Start from your quote." />
        ) : (
          <FlowColumns columns="md:grid-cols-[minmax(0,1fr)_420px] md:gap-14">
            <div>
              <h1 className="text-[32px] font-bold tracking-[-0.6px]">
                Buy your certified translation
              </h1>
              <p className="mt-2 mb-6 text-[15px] text-ink-muted">
                You’ve reviewed it. Pay once and download right away.
              </p>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold">Email</span>
                <input
                  data-testid="email"
                  type="email"
                  readOnly
                  value={email}
                  className={fieldClass}
                />
              </label>
              {notReady ? (
                <p data-testid="checkout-waiting" className="mt-4 text-sm text-ink-muted">
                  Your preview isn&apos;t ready yet. You can pay as soon as the translation
                  is ready to review.
                </p>
              ) : null}
              {notice ? (
                <p data-testid="checkout-waiting" role="alert" className="mt-4 text-sm text-ink-muted">
                  {notice}
                </p>
              ) : null}
              <button
                type="button"
                data-testid="pay-button"
                disabled={pending || notReady}
                onClick={() => void pay()}
                className={buttonClasses("primary", "mt-[22px] h-[52px] w-full text-base disabled:opacity-60")}
              >
                {pending ? "Opening checkout…" : `Pay ${totalLabel(order.totalCents)}`}
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
                  <b>{order.documents[0]?.filename ?? "Document"}</b>
                  <div className="text-[13px] text-ink-muted">
                    {languageLine(order)} · {order.billablePages ?? 0} pages
                  </div>
                  <div className="mt-1 text-[12.5px] text-[var(--cp-ok)]">
                    ✓ Reviewed
                  </div>
                </div>
              </div>
              <div className="mt-3.5">
                <Summary>
                  <SummaryRow
                    label={`${order.billablePages ?? 0} pages × ${formatMoney(order.unitPriceCents)}`}
                    value={
                      order.billablePages
                        ? formatMoney(order.billablePages * order.unitPriceCents)
                        : "Pending"
                    }
                  />
                  <SummaryRow label="Certificate of accuracy" value="Included" />
                  <SummaryRow
                    testId="order-total"
                    label="Total"
                    value={totalLabel(order.totalCents)}
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
        )}
      </main>
    </div>
  );
}
