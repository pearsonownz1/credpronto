"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useState, type FormEvent } from "react";
import { SavedMethodSummary, type SavedMethodFields } from "@/components/account/saved-method";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const primary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-primary bg-primary px-3 py-[7px] text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60";
const secondary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-medium text-ink";

type Card = SavedMethodFields;

async function persistSetupIntent(setupIntentId: string): Promise<{ card: Card | null; error: string | null }> {
  const response = await fetch("/api/me/billing/setup-intent/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ setupIntentId }),
  });
  const body = (await response.json().catch(() => null)) as { card?: Card | null; error?: string; code?: string } | null;
  if (!response.ok) return { card: null, error: body?.error ?? "The card was not saved." };
  return { card: body?.card ?? null, error: null };
}

function clearSetupReturn() {
  const url = new URL(window.location.href);
  url.searchParams.delete("setup_intent");
  url.searchParams.delete("setup_intent_client_secret");
  url.searchParams.delete("redirect_status");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export function BillingPanel() {
  const [card, setCard] = useState<Card | null>(null);
  const [terms, setTerms] = useState<"card" | "net">("card");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    async function load() {
      const params = new URLSearchParams(window.location.search);
      const setupIntentId = params.get("setup_intent");
      const redirectStatus = params.get("redirect_status");
      if (setupIntentId && redirectStatus === "succeeded") {
        const saved = await persistSetupIntent(setupIntentId);
        if (!cancel && saved.error) setNotice(saved.error);
        if (!cancel && saved.card) setCard(saved.card);
        clearSetupReturn();
      } else if (redirectStatus === "failed") {
        if (!cancel) setNotice("The card was not saved.");
        clearSetupReturn();
      }
      const response = await fetch("/api/me/billing");
      const body = (await response.json().catch(() => null)) as {
        card?: Card | null;
        terms?: string;
        error?: string;
      } | null;
      if (cancel) return;
      if (!response.ok) {
        setNotice(body?.error ?? "Couldn't load billing.");
        setLoaded(true);
        return;
      }
      setCard(body?.card ?? null);
      setTerms(body?.terms === "net" ? "net" : "card");
      setLoaded(true);
    }
    void load().catch(() => {
      if (!cancel) setNotice("Couldn't load billing.");
    });
    return () => {
      cancel = true;
    };
  }, []);

  async function startSetup() {
    if (!stripePromise) {
      setNotice("Card saving needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.");
      return;
    }
    setBusy("setup");
    setNotice(null);
    const response = await fetch("/api/me/billing/setup-intent", { method: "POST" });
    const body = (await response.json().catch(() => null)) as { clientSecret?: string; error?: string } | null;
    setBusy(null);
    if (!response.ok || !body?.clientSecret) {
      setNotice(body?.error ?? "Couldn't start card setup.");
      return;
    }
    setSecret(body.clientSecret);
  }

  async function removeCard() {
    setBusy("remove");
    setNotice(null);
    const response = await fetch("/api/me/billing", { method: "DELETE" });
    setBusy(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(body?.error ?? "Couldn't remove the card.");
      return;
    }
    setCard(null);
    setSecret(null);
  }

  return (
    <section data-testid="billing" className="min-w-0 font-normal">
      <h1 className="text-[26px] font-medium tracking-[-0.6px]">Billing</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Agents charge the saved card, or add the order to an invoice when this account is on net terms.
      </p>
      {notice ? (
        <p data-testid="billing-notice" className="mt-4 text-sm text-[#b42318]">
          {notice}
        </p>
      ) : null}
      <section className="mt-[22px] max-w-xl rounded-[var(--cp-radius)] border border-line bg-white">
        <header className="border-b border-line px-[18px] py-3.5">
          <h2 className="text-[15px] font-medium">Payment method</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {terms === "net"
              ? "This account is on invoice, net terms. Orders are added to the open invoice."
              : "A saved card is charged when an agent places an order."}
          </p>
        </header>
        <div className="px-[18px] py-4">
          {!loaded ? <p className="text-[13.5px] text-ink-muted">Loading…</p> : null}
          {loaded && terms === "net" ? (
            <p data-testid="billing-terms" className="mb-3 text-[13.5px]">
              Invoice, net terms
            </p>
          ) : null}
          {loaded && !card ? (
            <div data-testid="saved-card-empty" className="flex items-center justify-between gap-3">
              <p className="text-[13.5px] text-ink-muted">No card on file.</p>
              <button type="button" data-testid="add-card" className={primary} disabled={busy === "setup"} onClick={() => void startSetup()}>
                Add card
              </button>
            </div>
          ) : null}
          {card ? (
            <div data-testid="saved-card" className="flex flex-wrap items-center gap-3">
              <SavedMethodSummary method={card} />
              <button type="button" className={secondary} disabled={busy === "setup"} onClick={() => void startSetup()}>
                Replace
              </button>
              <button type="button" className={secondary} disabled={busy === "remove"} onClick={() => void removeCard()}>
                Remove
              </button>
            </div>
          ) : null}
          {secret && stripePromise ? (
            <div className="mt-3" data-testid="card-setup">
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret: secret,
                  appearance: { theme: "stripe", variables: { colorPrimary: "#1f5eff", borderRadius: "4px" } },
                }}
              >
                <CardForm
                  onSaved={(saved) => {
                    setSecret(null);
                    if (saved) setCard(saved);
                  }}
                  onError={setNotice}
                />
              </Elements>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function CardForm({
  onSaved,
  onError,
}: {
  onSaved: (card: Card | null) => void;
  onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/dashboard/billing` },
      redirect: "if_required",
    });
    setPending(false);
    if (error) {
      onError(error.message ?? "The card could not be saved.");
      return;
    }
    if (setupIntent?.id && setupIntent.status === "succeeded") {
      const saved = await persistSetupIntent(setupIntent.id);
      if (saved.error) onError(saved.error);
      else onSaved(saved.card);
      return;
    }
    onSaved(null);
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-3">
      <PaymentElement options={{ wallets: { link: "auto" } }} />
      <button type="submit" className={primary} disabled={pending}>
        Save card
      </button>
    </form>
  );
}
