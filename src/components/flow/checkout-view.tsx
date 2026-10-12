"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlowApiError, getFlowClient } from "@/lib/flow/client";
import { formatMoney, pageLabel } from "@/lib/flow/pricing";
import {
  checkoutFailureMessage,
  languageLine,
  servicePriceLines,
  totalLabel,
} from "@/lib/flow/present";
import { US_STATE_CODES, chargeCents, serviceCents, withoutExpedited } from "@/lib/orders/addons";
import type { AddonId, ShippingAddress } from "@/lib/orders/types";
import type { CustomerOrder } from "@/lib/orders/view";
import { FlowHeader } from "./flow-header";
import { FlowStatus } from "./status";
import { useCustomerOrder, useStoredEmail, useStoredToken } from "./use-order";
import { Checks, Field, FlowColumns, Summary, SummaryRow, buttonClasses, fieldClass } from "./ui";

export function CheckoutView({ token: pathToken }: { token?: string }) {
  const token = useStoredToken(pathToken);
  const email = useStoredEmail();
  const { order, error, loading } = useCustomerOrder(token, "once");

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
          <CheckoutForm key={order.orderId} token={token} email={email} order={order} />
        )}
      </main>
    </div>
  );
}

function CheckoutForm({
  token,
  email,
  order,
}: {
  token: string;
  email: string;
  order: CustomerOrder;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const evaluationOrder = order.orderType === "evaluation" || order.service != null;
  const [selected, setSelected] = useState<AddonId[]>(() =>
    withoutExpedited(
      order.addons.map((id) => ({ id })),
      !evaluationOrder,
    ).map((item) => item.id),
  );
  const [address, setAddress] = useState({
    name: order.shippingAddress?.name ?? "",
    line1: order.shippingAddress?.line1 ?? "",
    line2: order.shippingAddress?.line2 ?? "",
    city: order.shippingAddress?.city ?? "",
    state: order.shippingAddress?.state ?? "CA",
    postalCode: order.shippingAddress?.postalCode ?? "",
  });

  const notReady = order.status !== "preview_ready";
  const evaluation = order.orderType === "evaluation" || order.service != null;
  const options = withoutExpedited(order.addonOptions, !evaluation);
  const service = serviceCents(order);
  const due = chargeCents(service, options, selected);
  const mail = selected.includes("mail");
  const priceLines = servicePriceLines(order);

  function toggle(id: AddonId) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function shippingAddress(): ShippingAddress {
    return {
      name: address.name.trim(),
      line1: address.line1.trim(),
      line2: address.line2.trim() || null,
      city: address.city.trim(),
      state: address.state,
      postalCode: address.postalCode.trim(),
      country: "US",
    };
  }

  async function pay() {
    if (mail && (!address.name.trim() || !address.line1.trim() || !address.city.trim() || !address.postalCode.trim())) {
      setNotice("Mail requires a US shipping address");
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const result = await getFlowClient().checkout(token, {
        addons: evaluation ? selected : selected.filter((id) => id !== "expedited"),
        ...(mail ? { shippingAddress: shippingAddress() } : {}),
      });
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
    <FlowColumns columns="md:grid-cols-[minmax(0,1fr)_420px] md:gap-14">
      <div>
        <h1 className="text-[32px] font-bold tracking-[-0.6px]">
          {evaluation ? "Buy your credential evaluation" : "Buy your certified translation"}
        </h1>
        <p className="mt-2 mb-6 text-[15px] text-ink-muted">
          {evaluation
            ? "You’ve reviewed the report. Pay once. Staff sign off before it is released."
            : "You’ve reviewed it. Pay once and download right away."}
        </p>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold">Email</span>
          <input data-testid="email" type="email" readOnly value={email} className={fieldClass} />
        </label>
        <fieldset className="mt-6 grid gap-3" data-testid="checkout-addons">
          <legend className="mb-1 text-[13px] font-semibold">Add-ons</legend>
          {options.map((option) => {
            const unavailable = option.totalCents == null;
            const price =
              option.per === "page" && option.totalCents != null
                ? `${formatMoney(option.unitCents)} per page · ${formatMoney(option.totalCents)}`
                : formatMoney(option.unitCents);
            return (
              <label key={option.id} className="flex items-start gap-3 text-sm">
                <input
                  data-testid={`addon-${option.id}`}
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(option.id)}
                  disabled={unavailable || pending}
                  onChange={() => toggle(option.id)}
                />
                <span>
                  <span className="font-semibold">{option.label}</span>
                  <span className="text-ink-muted"> · {unavailable ? "Needs a page count" : price}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {mail ? (
          <div className="mt-4 grid gap-3" data-testid="shipping-address">
            <Field label="Ship to">
              <input
                data-testid="shipping-name"
                value={address.name}
                onChange={(event) => setAddress({ ...address, name: event.target.value })}
                className={fieldClass}
                autoComplete="name"
              />
            </Field>
            <Field label="Address">
              <input
                data-testid="shipping-line1"
                value={address.line1}
                onChange={(event) => setAddress({ ...address, line1: event.target.value })}
                className={fieldClass}
                autoComplete="address-line1"
              />
            </Field>
            <Field label="Address line 2" optional>
              <input
                data-testid="shipping-line2"
                value={address.line2}
                onChange={(event) => setAddress({ ...address, line2: event.target.value })}
                className={fieldClass}
                autoComplete="address-line2"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="City">
                <input
                  data-testid="shipping-city"
                  value={address.city}
                  onChange={(event) => setAddress({ ...address, city: event.target.value })}
                  className={fieldClass}
                  autoComplete="address-level2"
                />
              </Field>
              <Field label="State">
                <select
                  data-testid="shipping-state"
                  value={address.state}
                  onChange={(event) => setAddress({ ...address, state: event.target.value })}
                  className={fieldClass}
                  autoComplete="address-level1"
                >
                  {US_STATE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="ZIP code">
              <input
                data-testid="shipping-postal"
                value={address.postalCode}
                onChange={(event) => setAddress({ ...address, postalCode: event.target.value })}
                className={fieldClass}
                autoComplete="postal-code"
                inputMode="numeric"
              />
            </Field>
          </div>
        ) : null}
        {notReady ? (
          <p data-testid="checkout-waiting" className="mt-4 text-sm text-ink-muted">
            {evaluation
              ? "Your preview isn't ready yet. You can pay as soon as the report is ready to review."
              : "Your preview isn't ready yet. You can pay as soon as the translation is ready to review."}
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
          disabled={pending || notReady || due == null}
          onClick={() => void pay()}
          className={buttonClasses("primary", "mt-[22px] h-[52px] w-full text-base disabled:opacity-60")}
        >
          {pending ? "Opening checkout…" : `Pay ${due != null ? formatMoney(due) : totalLabel(order.totalCents)}`}
        </button>
        <p className="mt-2.5 text-center text-xs text-ink-muted">
          <span aria-hidden>🔒 </span>
          Secure payment by Stripe
        </p>
      </div>
      <div>
        <div className="flex items-center gap-3.5 rounded-[var(--cp-radius)] border border-line p-[18px]">
          <div className="relative h-[74px] w-[58px] shrink-0 overflow-hidden border border-line bg-bg" aria-hidden>
            <div className="flow-lines absolute inset-2" />
          </div>
          <div className="text-sm">
            <b>{order.documents[0]?.filename ?? "Document"}</b>
            <div className="text-[13px] text-ink-muted">
              {languageLine(order)} · {pageLabel(order.billablePages ?? 0)}
            </div>
            <div className="mt-1 text-[12.5px] text-[var(--cp-ok)]">✓ Reviewed</div>
          </div>
        </div>
        <div className="mt-3.5">
          <Summary>
            {priceLines.length > 0 ? (
              priceLines.map((line, index) => (
                <SummaryRow
                  key={`${line.label}-${index}`}
                  label={line.label}
                  value={formatMoney(line.amountCents)}
                />
              ))
            ) : (
              <SummaryRow
                label={evaluation ? "Evaluation" : "Pages"}
                value={service != null ? formatMoney(service) : "Pending"}
              />
            )}
            <SummaryRow
              label={evaluation ? "Evaluation report" : "Certificate of accuracy"}
              value="Included"
            />
            {options
              .filter((option) => selected.includes(option.id) && option.totalCents != null)
              .map((option) => (
                <SummaryRow
                  key={option.id}
                  testId={`summary-${option.id}`}
                  label={option.label}
                  value={formatMoney(option.totalCents ?? 0)}
                />
              ))}
            <SummaryRow
              testId="order-total"
              label="Total"
              value={due != null ? formatMoney(due) : totalLabel(order.totalCents)}
              emphasize
            />
          </Summary>
        </div>
        <div className="mt-[18px]">
          <Checks
            items={
              evaluation
                ? ["Evaluation report PDF", "Signed by the CredPronto Certification Team", "Emailed and downloadable anytime"]
                : ["Clean PDF, no watermark", "Signed certification page", "Emailed and downloadable anytime"]
            }
          />
        </div>
      </div>
    </FlowColumns>
  );
}
