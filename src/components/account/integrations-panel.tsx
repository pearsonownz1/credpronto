"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAccountShell } from "@/components/account/account-shell";
import type { ApiResult } from "@/lib/api/types";
import {
  WEBHOOK_EVENTS,
  getIntegrationsClient,
  type ApiKeyMode,
  type ApiKeyRecord,
  type RevealedKey,
  type SavedCard,
} from "@/lib/integrations/client";
import { formatCardLabel, formatKeyCreated, maskKey, maskWebhookSecret } from "@/lib/integrations/present";

const QUICK_START = `curl https://www.credpronto.com/api/v1/orders \\
  -H "Authorization: Bearer cp_test_…" \\
  -F file=@acta.pdf \\
  -F service=translation \\
  -F source_language=es

# Verify the CredPronto-Signature header on each webhook.
# It is t=<unix seconds>,v1=<hex HMAC-SHA256 of \${t}.\${rawBody}>.`;

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const secondary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-semibold text-ink";
const primary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-primary bg-primary px-3 py-[7px] text-[13px] font-semibold text-white disabled:opacity-60";
const dangerButton =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-semibold text-[#b42318]";
const field =
  "h-[38px] min-w-0 flex-1 rounded-[var(--cp-radius)] border border-line bg-white px-3 font-mono text-[12.5px] outline-none";

export function IntegrationsPanel() {
  const { account } = useAccountShell();
  const client = getIntegrationsClient();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [card, setCard] = useState<SavedCard | null>(null);
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [keyName, setKeyName] = useState("Production");
  const [keyMode, setKeyMode] = useState<ApiKeyMode>("test");
  const [webhookUrl, setWebhookUrl] = useState("https://api.yourfirm.com/credpronto/hooks");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<"key" | "secret" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancel = false;
    void client.load().then((result) => {
      if (cancel) return;
      if (result.ok) {
        setKeys(result.data.keys);
        setCard(result.data.card);
      } else setNotice(result.error);
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("redirect_status") === "succeeded") {
      void pollCard(client, setCard, setNotice, setSetupSecret);
    }
    return () => {
      cancel = true;
    };
  }, [client]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  function markCopied(which: "key" | "secret") {
    setCopied(which);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  async function run<T>(id: string, action: () => Promise<ApiResult<T>>, apply: (data: T) => void) {
    setBusy(id);
    setNotice(null);
    const result = await action();
    setBusy(null);
    if (result.ok) apply(result.data);
    else setNotice(result.error);
  }

  const activeKeys = keys.filter((key) => !key.revokedAt);

  return (
    <section data-testid="integrations" className="min-w-0">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] tracking-[-0.6px]">Integrations</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Send orders from your own system and get certified files back automatically.
          </p>
        </div>
        <a
          href="https://www.credpronto.com/docs/api"
          target="_blank"
          rel="noreferrer"
          data-testid="api-docs"
          className={secondary}
        >
          Read the API docs ↗
        </a>
      </div>
      {notice ? (
        <p data-testid="integrations-notice" className="mb-4 text-sm text-[#b42318]">
          {notice}
        </p>
      ) : null}
      <div className="grid min-w-0 items-start gap-[18px] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Panel
            title="API keys"
            subtitle="Keys are shown once. Store them somewhere safe."
            action={
              <button
                type="button"
                data-testid="create-key"
                data-emphasis="primary"
                className={primary}
                disabled={busy === "create" || keyName.trim() === ""}
                onClick={() =>
                  void run("create", () => client.createKey({ name: keyName.trim(), mode: keyMode }), (created) => {
                    setKeys((current) => [created, ...current.filter((key) => key.id !== created.id)]);
                    setRevealed({ id: created.id, name: created.name, secret: created.secret });
                  })
                }
              >
                + Create key
              </button>
            }
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-[18px] py-3">
              <label className="min-w-0 flex-1 text-[12.5px] text-ink-muted">
                Name
                <input
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  maxLength={80}
                  data-testid="key-name"
                  className={`${field} mt-1.5 w-full font-sans text-[13.5px]`}
                />
              </label>
              <label className="text-[12.5px] text-ink-muted">
                Mode
                <select
                  value={keyMode}
                  onChange={(event) => setKeyMode(event.target.value === "live" ? "live" : "test")}
                  data-testid="key-mode"
                  className="mt-1.5 block h-[38px] rounded-[var(--cp-radius)] border border-line bg-white px-2 font-sans text-[13.5px] text-ink"
                >
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select>
              </label>
            </div>
            {revealed ? (
              <div data-testid="new-key" className="border-b border-[#c9d6ff] bg-[#f7f9ff] px-[18px] py-3 text-[13px]">
                <p>
                  <span className="font-semibold">New key &quot;{revealed.name}&quot; created.</span> Copy it now. You
                  won&apos;t see it again.
                </p>
                <div className="mt-2 flex h-[38px] items-center justify-between gap-3 rounded-[var(--cp-radius)] border border-line bg-white px-3 font-mono text-[12.5px]">
                  <span data-testid="new-key-secret" className="min-w-0 truncate">
                    {revealed.secret}
                  </span>
                  <button
                    type="button"
                    data-testid="copy-key"
                    className="shrink-0 font-sans text-[13px] font-semibold text-primary"
                    onClick={() =>
                      void navigator.clipboard.writeText(revealed.secret).then(
                        () => markCopied("key"),
                        () => setNotice("Couldn't copy the key."),
                      )
                    }
                  >
                    {copied === "key" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr className="bg-[#fafbfc] text-left text-[12.5px] font-medium text-ink-muted">
                    <th className="px-[18px] py-2.5">Name</th>
                    <th className="px-[18px] py-2.5">Key</th>
                    <th className="px-[18px] py-2.5">Created</th>
                    <th className="px-[18px] py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {activeKeys.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-[18px] py-[13px] text-ink-muted">
                        No active keys.
                      </td>
                    </tr>
                  ) : (
                    activeKeys.map((key) => (
                      <tr key={key.id} data-testid={`key-${key.id}`} className="border-t border-line">
                        <td className="px-[18px] py-[13px] font-semibold">{key.name}</td>
                        <td className="px-[18px] py-[13px] font-mono text-[12.5px]" data-testid={`key-mask-${key.id}`}>
                          {maskKey(key.prefix, key.last4)}
                        </td>
                        <td className="px-[18px] py-[13px]">{formatKeyCreated(key.createdAt)}</td>
                        <td className="px-[18px] py-[13px] text-right">
                          <button
                            type="button"
                            data-testid={`revoke-${key.id}`}
                            aria-label={`Revoke ${key.name}`}
                            className="text-[13px] font-semibold text-[#b42318]"
                            onClick={() =>
                              void run(key.id, () => client.revokeKey(key.id), (revoked) => {
                                setKeys((current) =>
                                  current.map((item) =>
                                    item.id === revoked.id ? { ...item, revokedAt: revoked.revokedAt ?? new Date().toISOString() } : item,
                                  ),
                                );
                                setRevealed((current) => (current?.id === revoked.id ? null : current));
                              })
                            }
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel
            title="Webhook"
            subtitle="We POST order updates here, signed with your secret."
            action={
              <button
                type="button"
                data-testid="save-webhook"
                className={secondary}
                disabled={busy === "webhook"}
                onClick={() =>
                  void run("webhook", () => client.saveWebhook(webhookUrl), (saved) => {
                    setWebhookUrl(saved.url);
                    setWebhookSecret(saved.secret);
                    setSecretVisible(false);
                  })
                }
              >
                Save webhook
              </button>
            }
          >
            <div className="px-[18px] py-4 text-[13.5px]">
              <p className="mb-1.5 text-[12.5px] text-ink-muted">Endpoint URL</p>
              <input
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                data-testid="webhook-url"
                inputMode="url"
                className={`${field} w-full`}
              />
              <p className="mt-3.5 mb-1.5 text-[12.5px] text-ink-muted">Signing secret</p>
              <div className="flex h-[38px] items-center justify-between gap-3 rounded-[var(--cp-radius)] border border-line px-3 font-mono text-[12.5px]">
                <span data-testid="webhook-secret" className="min-w-0 truncate">
                  {webhookSecret
                    ? secretVisible
                      ? webhookSecret
                      : maskWebhookSecret(webhookSecret.slice(-4))
                    : "Shown once when you save"}
                </span>
                {webhookSecret ? (
                  <button
                    type="button"
                    data-testid="reveal-secret"
                    className="shrink-0 font-sans text-[13px] font-semibold text-primary"
                    onClick={() => setSecretVisible((value) => !value)}
                  >
                    {secretVisible ? "Hide" : "Reveal"}
                  </button>
                ) : null}
              </div>
              {webhookSecret ? (
                <button
                  type="button"
                  data-testid="copy-secret"
                  className="mt-2 text-[13px] font-semibold text-primary"
                  onClick={() =>
                    void navigator.clipboard.writeText(webhookSecret).then(
                      () => markCopied("secret"),
                      () => setNotice("Couldn't copy the secret."),
                    )
                  }
                >
                  {copied === "secret" ? "Copied" : "Copy secret"}
                </button>
              ) : null}
              <p className="mt-3.5 mb-1.5 text-[12.5px] text-ink-muted">Events</p>
              <div>
                {WEBHOOK_EVENTS.map((event) => (
                  <span
                    key={event}
                    data-testid={`event-${event}`}
                    className="mb-1.5 mr-1.5 inline-block rounded-full border border-[#c9d6ff] bg-[#eaf0ff] px-[9px] py-[3px] font-mono text-[11.5px] text-primary"
                  >
                    {event}
                  </span>
                ))}
              </div>
            </div>
          </Panel>
        </div>
        <div className="min-w-0">
          <Panel title="Billing for API orders" subtitle="Charged automatically when an order is placed.">
            <div className="px-[18px] py-4">
              {card ? (
                <div data-testid="saved-card" className="flex flex-wrap items-center gap-3 rounded-[var(--cp-radius)] border border-line p-3">
                  <span className="inline-flex h-7 w-[42px] items-center justify-center rounded-[var(--cp-radius)] bg-[#1a1f71] text-[11px] font-bold text-white">
                    {card.brand.toLowerCase() === "visa" ? "VISA" : "MC"}
                  </span>
                  <span className="text-[13.5px] font-semibold">{formatCardLabel(cardBrand(card.brand), card.last4)}</span>
                  <button
                    type="button"
                    data-testid="replace-card"
                    className={`${secondary} ml-auto`}
                    disabled={busy === "setup"}
                    onClick={() => void startSetup(client, setBusy, setNotice, setSetupSecret)}
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <div data-testid="saved-card-empty" className="flex items-center justify-between gap-3">
                  <p className="text-[13.5px] text-ink-muted">No card on file.</p>
                  <button
                    type="button"
                    data-testid="replace-card"
                    className={secondary}
                    disabled={busy === "setup"}
                    onClick={() => void startSetup(client, setBusy, setNotice, setSetupSecret)}
                  >
                    Replace
                  </button>
                </div>
              )}
              {setupSecret && stripePromise ? (
                <div className="mt-3" data-testid="card-setup">
                  <Elements stripe={stripePromise} options={{ clientSecret: setupSecret }}>
                    <CardSetupForm
                      onSaved={() => {
                        setSetupSecret(null);
                        void pollCard(client, setCard, setNotice, setSetupSecret);
                      }}
                      onError={setNotice}
                    />
                  </Elements>
                </div>
              ) : null}
              <p className="mt-2.5 text-[12.5px] text-ink-muted">
                Receipts go to {account.email}. Orders placed in the dashboard still check out normally.
              </p>
              {card ? (
                <div className="mt-3">
                  <button
                    type="button"
                    data-testid="remove-card"
                    className={dangerButton}
                    onClick={() =>
                      void run("remove", () => client.removeCard(), () => {
                        setCard(null);
                        setSetupSecret(null);
                      })
                    }
                  >
                    Remove card
                  </button>
                </div>
              ) : null}
            </div>
          </Panel>
          <Panel title="Quick start" subtitle="Place an order with one call.">
            <div className="px-[18px] py-4">
              <pre
                data-testid="quick-start"
                className="overflow-x-auto rounded-[var(--cp-radius)] bg-[#0b1220] p-4 font-mono text-[11.5px] leading-[1.6] whitespace-pre text-[#d6e0ff]"
              >
                {QUICK_START}
              </pre>
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function cardBrand(brand: string): string {
  const lower = brand.toLowerCase();
  if (lower === "visa") return "Visa";
  if (lower === "mastercard") return "Mastercard";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

async function startSetup(
  client: ReturnType<typeof getIntegrationsClient>,
  setBusy: (value: string | null) => void,
  setNotice: (value: string | null) => void,
  setSetupSecret: (value: string | null) => void,
) {
  if (!stripePromise) {
    setNotice("Card saving needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.");
    return;
  }
  setBusy("setup");
  setNotice(null);
  const result = await client.createSetupIntent();
  setBusy(null);
  if (result.ok) setSetupSecret(result.data.clientSecret);
  else setNotice(result.error);
}

async function pollCard(
  client: ReturnType<typeof getIntegrationsClient>,
  setCard: (card: SavedCard | null) => void,
  setNotice: (value: string | null) => void,
  setSetupSecret: (value: string | null) => void,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await client.loadCard();
    if (result.ok && result.data) {
      setCard(result.data);
      setSetupSecret(null);
      setNotice(null);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  setNotice("The card was confirmed. It will show here after Stripe finishes saving it.");
}

function CardSetupForm({ onSaved, onError }: { onSaved: () => void; onError: (message: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/dashboard/integrations` },
      redirect: "if_required",
    });
    setPending(false);
    if (error) onError(error.message ?? "The card could not be saved.");
    else onSaved();
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-3">
      <PaymentElement />
      <button type="submit" data-testid="save-card" className={secondary} disabled={!stripe || pending}>
        Save card
      </button>
    </form>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-[18px] min-w-0 rounded-[var(--cp-radius)] border border-line bg-white">
      <header className="flex items-center justify-between gap-4 border-b border-line px-[18px] py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">{subtitle}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
