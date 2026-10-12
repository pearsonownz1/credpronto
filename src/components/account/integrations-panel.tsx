"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiResult } from "@/lib/api/types";
import {
  WEBHOOK_EVENTS,
  getIntegrationsClient,
  isLiveWebhookEvent,
  isUnavailableStatus,
  pendingWebhookEvents,
  type ApiKeyMode,
  type ApiKeyRecord,
  type ApiOrder,
  type IntegrationsSnapshot,
  type RevealedKey,
  type SavedCard,
  type Section,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@/lib/integrations/client";
import {
  apiOrdersCsv,
  formatCardExpiry,
  formatCardLabel,
  formatCharged,
  formatDeliveryStatus,
  formatKeyCreated,
  formatKeyPrefix,
  formatLastUsed,
  formatPlaced,
  maskWebhookSecret,
  QUICK_START_CODE_CLASS,
  integrationSamples,
  quickStartCurl,
  safeOrderLink,
} from "@/lib/integrations/present";
import { API_DOCS_PATH } from "@/lib/seo";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const secondary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-semibold text-ink";
const primary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-primary bg-primary px-3 py-[7px] text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60";
const dangerButton =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-semibold text-[#b42318]";
const field =
  "h-[38px] min-w-0 flex-1 rounded-[var(--cp-radius)] border border-line bg-white px-3 font-mono text-[12.5px] outline-none";

const BILLING_NOTE = "API orders are charged to this card when placed. Dashboard orders still check out normally.";

type Copied = "key" | "secret" | "curl";

export function IntegrationsPanel() {
  const client = getIntegrationsClient();
  const [snapshot, setSnapshot] = useState<IntegrationsSnapshot | null>(null);
  const [keys, setKeys] = useState<ApiKeyRecord[] | null>(null);
  const [card, setCard] = useState<SavedCard | null>(null);
  const [cardState, setCardState] = useState<Section<SavedCard | null> | null>(null);
  const [webhook, setWebhook] = useState<Section<WebhookEndpoint | null> | null>(null);
  const [orders, setOrders] = useState<Section<ApiOrder[]> | null>(null);
  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyMode, setKeyMode] = useState<ApiKeyMode>("test");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlEdited = useRef(false);

  useEffect(() => {
    let cancel = false;
    void client.load().then((result) => {
      if (cancel || !result.ok) return;
      setSnapshot(result.data);
      if (result.data.keys.status === "ready") setKeys(result.data.keys.data);
      if (result.data.card.status === "ready") setCard(result.data.card.data);
      setCardState(result.data.card);
      setWebhook(result.data.webhook);
      setOrders(result.data.apiOrders);
      if (!urlEdited.current && result.data.webhook.status === "ready" && result.data.webhook.data) {
        setWebhookUrl(result.data.webhook.data.url);
        if (result.data.webhook.data.secret) setWebhookSecret(result.data.webhook.data.secret);
      }
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("redirect_status") === "succeeded") {
      void pollCard(client, setCard, setCardState, setNotice, setSetupSecret);
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

  function markCopied(which: Copied) {
    setCopied(which);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  async function copy(which: Copied, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      markCopied(which);
    } catch {
      setNotice("Couldn't copy that.");
    }
  }

  async function run<T>(id: string, action: () => Promise<ApiResult<T>>, apply: (data: T) => void) {
    setBusy(id);
    setNotice(null);
    const result = await action();
    setBusy(null);
    if (result.ok) apply(result.data);
    else setNotice(result.error);
    return result;
  }

  const activeKeys = (keys ?? []).filter((key) => !key.revokedAt);
  const lastUsedKnown = activeKeys.length === 0 || activeKeys.every((key) => key.lastUsedKnown);
  const curl = quickStartCurl(revealed?.secret ?? null);
  const savedDelivery = webhook?.status === "ready" ? (webhook.data?.lastDelivery ?? null) : null;

  return (
    <section data-testid="integrations" className="min-w-0">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] tracking-[-0.6px]">Integrations</h1>
          <p className="mt-1 text-sm text-ink-muted">Send orders from your own system and get certified files back automatically.</p>
        </div>
        <a href={API_DOCS_PATH} target="_blank" rel="noreferrer" data-testid="api-docs" className={secondary}>
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
            subtitle="The full key is shown once. Store it somewhere safe."
            action={
              <button
                type="button"
                data-testid="create-key"
                data-emphasis="primary"
                className={primary}
                disabled={busy === "create" || keyName.trim() === ""}
                onClick={() =>
                  void run("create", () => client.createKey({ name: keyName.trim(), mode: keyMode }), (created) => {
                    setKeys((current) => [created, ...(current ?? []).filter((key) => key.id !== created.id)]);
                    setRevealed({ id: created.id, name: created.name, secret: created.secret });
                    setPendingRevoke(null);
                  })
                }
              >
                Create key
              </button>
            }
          >
            <div className="flex flex-wrap items-end gap-2 border-b border-line px-[18px] py-3">
              <label className="min-w-0 flex-1 text-[12.5px] text-ink-muted">
                Name
                <input
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  maxLength={80}
                  placeholder="Production"
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
                <p data-testid="new-key-note">
                  <span className="font-semibold">New key &quot;{revealed.name}&quot; created.</span> Copy it now. You won&apos;t
                  see this again.
                </p>
                <div className="mt-2 flex h-[38px] items-center justify-between gap-3 rounded-[var(--cp-radius)] border border-line bg-white px-3 font-mono text-[12.5px]">
                  <span data-testid="new-key-secret" className="min-w-0 truncate">
                    {revealed.secret}
                  </span>
                  <button
                    type="button"
                    data-testid="copy-key"
                    className="shrink-0 font-sans text-[13px] font-semibold text-primary"
                    onClick={() => void copy("key", revealed.secret)}
                  >
                    {copied === "key" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            ) : null}
            <KeysTable
              loaded={snapshot !== null}
              section={snapshot?.keys ?? null}
              stored={keys}
              keys={activeKeys}
              lastUsedKnown={lastUsedKnown}
              now={now}
              pendingRevoke={pendingRevoke}
              busy={busy}
              onAskRevoke={setPendingRevoke}
              onCancelRevoke={() => setPendingRevoke(null)}
              onConfirmRevoke={(id) =>
                void run(id, () => client.revokeKey(id), (revoked) => {
                  setKeys((current) =>
                    (current ?? []).map((item) =>
                      item.id === revoked.id ? { ...item, revokedAt: revoked.revokedAt ?? new Date().toISOString() } : item,
                    ),
                  );
                  setRevealed((current) => (current?.id === revoked.id ? null : current));
                  setPendingRevoke(null);
                })
              }
            />
          </Panel>
          <Panel
            title="Webhook"
            subtitle="We POST order updates here, signed with your secret."
            action={
              <button
                type="button"
                data-testid="save-webhook"
                className={secondary}
                disabled={busy === "webhook" || webhookUrl.trim() === ""}
                onClick={() =>
                  void run("webhook", () => client.saveWebhook(webhookUrl.trim()), (saved) => {
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
                onChange={(event) => {
                  urlEdited.current = true;
                  setWebhookUrl(event.target.value);
                }}
                placeholder="https://example.com/hooks"
                data-testid="webhook-url"
                inputMode="url"
                className={`${field} w-full`}
              />
              <p data-testid="webhook-delivery" className="mt-2 text-[12.5px] text-ink-muted">
                Last delivery: {deliveryLine(webhook, savedDelivery)}
              </p>
              <p className="mt-3.5 mb-1.5 text-[12.5px] text-ink-muted">Signing secret</p>
              <SecretRow
                secret={webhookSecret}
                last4={webhook?.status === "ready" ? (webhook.data?.secretLast4 ?? null) : null}
                visible={secretVisible}
                copied={copied === "secret"}
                onToggle={() => setSecretVisible((value) => !value)}
                onCopy={() => {
                  if (webhookSecret) void copy("secret", webhookSecret);
                }}
              />
              <p className="mt-3.5 mb-1.5 text-[12.5px] text-ink-muted">Events</p>
              <div>
                {WEBHOOK_EVENTS.map((event) => (
                  <span
                    key={event}
                    data-testid={`event-${event}`}
                    data-available={isLiveWebhookEvent(event) ? "true" : "false"}
                    className="mb-1.5 mr-1.5 inline-block rounded-[var(--cp-radius)] border border-[#c9d6ff] bg-[#eaf0ff] px-[9px] py-[3px] font-mono text-[11.5px] text-primary"
                  >
                    {event}
                  </span>
                ))}
              </div>
              {pendingWebhookEvents().length > 0 ? (
                <p data-testid="webhook-events-soon" className="mt-1 text-[12.5px] text-ink-muted">
                  {pendingWebhookEvents().join(", ")} are coming soon.
                </p>
              ) : null}
              <div className="mt-3.5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="send-test"
                  data-emphasis="primary"
                  className={primary}
                  disabled={busy === "test"}
                  onClick={() => {
                    setBusy("test");
                    setNotice(null);
                    setTestNote(null);
                    void client.sendTest().then((result) => {
                      setBusy(null);
                      if (result.ok) {
                        setTestNote(`Test delivery: ${formatDeliveryStatus(result.data)}`);
                        setWebhook((current) =>
                          current?.status === "ready" && current.data
                            ? { status: "ready", data: { ...current.data, lastDelivery: result.data } }
                            : current,
                        );
                        return;
                      }
                      if (isUnavailableStatus(result.status)) {
                        setTestNote("Test deliveries are coming soon.");
                        return;
                      }
                      setNotice(result.error);
                    });
                  }}
                >
                  Send test
                </button>
                {testNote ? (
                  <p data-testid="webhook-test-result" className="text-[12.5px] text-ink-muted">
                    {testNote}
                  </p>
                ) : null}
              </div>
            </div>
          </Panel>
        </div>
        <div className="min-w-0">
          <Panel title="Billing for API orders" subtitle="Charged automatically when an order is placed.">
            <div className="px-[18px] py-4">
              <BillingCard
                state={cardState}
                card={card}
                busy={busy}
                onReplace={() => void startSetup(client, setBusy, setNotice, setSetupSecret)}
                onRemove={() =>
                  void run("remove", () => client.removeCard(), () => {
                    setCard(null);
                    setCardState({ status: "ready", data: null });
                    setSetupSecret(null);
                  })
                }
              />
              {setupSecret && stripePromise ? (
                <div className="mt-3" data-testid="card-setup">
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: setupSecret,
                      appearance: {
                        theme: "stripe",
                        variables: {
                          colorPrimary: "#1f5eff",
                          borderRadius: "4px",
                          colorBackground: "#ffffff",
                          colorText: "#0b1220",
                        },
                      },
                    }}
                  >
                    <CardSetupForm
                      onSaved={() => {
                        setSetupSecret(null);
                        void pollCard(client, setCard, setCardState, setNotice, setSetupSecret);
                      }}
                      onError={setNotice}
                    />
                  </Elements>
                </div>
              ) : null}
              <p data-testid="billing-note" className="mt-2.5 text-[12.5px] text-ink-muted">
                {BILLING_NOTE}
              </p>
            </div>
          </Panel>
          <Panel title="Quick start" subtitle="Place an order with one call. The key above is shown once.">
            <div className="min-w-0 px-[18px] py-4">
              <div className="mb-2 flex justify-end">
                <button type="button" data-testid="copy-quick-start" className="text-[13px] font-semibold text-primary" onClick={() => void copy("curl", curl)}>
                  {copied === "curl" ? "Copied" : "Copy"}
                </button>
              </div>
              <div data-testid="quick-start" className="grid min-w-0 gap-4">
                {integrationSamples(revealed?.secret ?? null).map((sample) => (
                  <div key={sample.id} className="min-w-0">
                    <p className="mb-1.5 text-[12.5px] font-semibold text-ink">{sample.title}</p>
                    <pre data-testid={sample.id} className={QUICK_START_CODE_CLASS}>
                      {sample.code}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
      <ApiOrdersSection orders={orders} loaded={snapshot !== null} />
    </section>
  );
}

function deliveryLine(section: Section<WebhookEndpoint | null> | null, delivery: WebhookDelivery | null): string {
  if (!section) return "Loading…";
  if (section.status === "unavailable") return "Coming soon";
  if (section.status === "error") return section.message;
  return formatDeliveryStatus(delivery);
}

function KeysTable({
  loaded,
  section,
  stored,
  keys,
  lastUsedKnown,
  now,
  pendingRevoke,
  busy,
  onAskRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  loaded: boolean;
  section: Section<ApiKeyRecord[]> | null;
  stored: ApiKeyRecord[] | null;
  keys: ApiKeyRecord[];
  lastUsedKnown: boolean;
  now: number;
  pendingRevoke: string | null;
  busy: string | null;
  onAskRevoke: (id: string) => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: (id: string) => void;
}) {
  if (!loaded) {
    return <p className="px-[18px] py-[13px] text-[13.5px] text-ink-muted">Loading keys…</p>;
  }
  if (stored == null && section?.status === "error") {
    return (
      <p data-testid="keys-error" className="px-[18px] py-[13px] text-[13.5px] text-[#b42318]">
        {section.message}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr className="bg-[#fafbfc] text-left text-[12.5px] font-medium text-ink-muted">
            <th className="px-[18px] py-2.5">Name</th>
            <th className="px-[18px] py-2.5">Prefix</th>
            <th className="px-[18px] py-2.5">Created</th>
            <th className="px-[18px] py-2.5">Last used</th>
            <th className="px-[18px] py-2.5" />
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-[18px] py-[13px] text-ink-muted">
                No active keys.
              </td>
            </tr>
          ) : (
            keys.map((key) => (
              <tr key={key.id} data-testid={`key-${key.id}`} className="border-t border-line">
                <td className="px-[18px] py-[13px] font-semibold">{key.name}</td>
                <td className="px-[18px] py-[13px] font-mono text-[12.5px]" data-testid={`key-prefix-${key.id}`} title={`Last 4 characters ${key.last4}`}>
                  {formatKeyPrefix(key.prefix, key.last4)}
                </td>
                <td className="px-[18px] py-[13px]">{formatKeyCreated(key.createdAt)}</td>
                <td className="px-[18px] py-[13px]" data-testid={`key-last-used-${key.id}`}>
                  {key.lastUsedKnown ? formatLastUsed(key.lastUsedAt, now) : "—"}
                </td>
                <td className="px-[18px] py-[13px] text-right">
                  {pendingRevoke === key.id ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      <span className="text-[12.5px] text-ink-muted">Revoke this key?</span>
                      <button
                        type="button"
                        data-testid={`revoke-confirm-${key.id}`}
                        className="text-[13px] font-semibold text-[#b42318]"
                        disabled={busy === key.id}
                        onClick={() => onConfirmRevoke(key.id)}
                      >
                        Revoke key
                      </button>
                      <button type="button" data-testid={`revoke-cancel-${key.id}`} className="text-[13px] font-semibold text-ink" onClick={onCancelRevoke}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`revoke-${key.id}`}
                      aria-label={`Revoke ${key.name}`}
                      className="text-[13px] font-semibold text-[#b42318]"
                      onClick={() => onAskRevoke(key.id)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {keys.length > 0 && !lastUsedKnown ? (
        <p data-testid="last-used-soon" className="border-t border-line px-[18px] py-2 text-[12.5px] text-ink-muted">
          Last used is coming soon.
        </p>
      ) : null}
    </div>
  );
}

function SecretRow({
  secret,
  last4,
  visible,
  copied,
  onToggle,
  onCopy,
}: {
  secret: string | null;
  last4: string | null;
  visible: boolean;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
}) {
  const shown = secret ? (visible ? secret : maskWebhookSecret(secret.slice(-4))) : last4 ? maskWebhookSecret(last4) : "Shown once when you save";
  return (
    <div>
      <div className="flex h-[38px] items-center justify-between gap-3 rounded-[var(--cp-radius)] border border-line px-3 font-mono text-[12.5px]">
        <span data-testid="webhook-secret" className="min-w-0 truncate">
          {shown}
        </span>
        {secret ? (
          <span className="flex shrink-0 gap-3 font-sans">
            <button type="button" data-testid="reveal-secret" className="text-[13px] font-semibold text-primary" onClick={onToggle}>
              {visible ? "Hide" : "Reveal"}
            </button>
            <button type="button" data-testid="copy-secret" className="text-[13px] font-semibold text-primary" onClick={onCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BillingCard({
  state,
  card,
  busy,
  onReplace,
  onRemove,
}: {
  state: Section<SavedCard | null> | null;
  card: SavedCard | null;
  busy: string | null;
  onReplace: () => void;
  onRemove: () => void;
}) {
  if (!state) return <p className="text-[13.5px] text-ink-muted">Loading card…</p>;
  if (state.status === "error") {
    return <p data-testid="billing-error" className="text-[13.5px] text-[#b42318]">{state.message}</p>;
  }
  if (state.status === "unavailable") {
    return <p data-testid="billing-soon" className="text-[13.5px] text-ink-muted">Saved cards are coming soon.</p>;
  }
  if (!card) {
    return (
      <div data-testid="saved-card-empty" className="flex items-center justify-between gap-3">
        <p className="text-[13.5px] text-ink-muted">No card on file.</p>
        <button type="button" data-testid="replace-card" className={secondary} disabled={busy === "setup"} onClick={onReplace}>
          Replace
        </button>
      </div>
    );
  }
  const expiry = card.expMonth != null && card.expYear != null ? formatCardExpiry(card.expMonth, card.expYear) : "Expiry coming soon";
  return (
    <div data-testid="saved-card" className="flex flex-wrap items-center gap-3 rounded-[var(--cp-radius)] border border-line p-3">
      <span className="inline-flex h-7 min-w-[42px] items-center justify-center rounded-[var(--cp-radius)] bg-[#1a1f71] px-1.5 text-[11px] font-bold text-white">
        {cardBadge(card.brand)}
      </span>
      <span className="text-[13.5px]">
        <span className="font-semibold">{formatCardLabel(cardBrand(card.brand), card.last4)}</span>
        <span data-testid="card-exp" className="mt-0.5 block text-[12.5px] text-ink-muted">
          {expiry}
        </span>
      </span>
      <button type="button" data-testid="replace-card" className={`${secondary} ml-auto`} disabled={busy === "setup"} onClick={onReplace}>
        Replace
      </button>
      <button type="button" data-testid="remove-card" className={dangerButton} disabled={busy === "remove"} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function ApiOrdersSection({ orders, loaded }: { orders: Section<ApiOrder[]> | null; loaded: boolean }) {
  const ready = orders?.status === "ready" ? orders.data : null;
  return (
    <Panel
      title="API orders"
      subtitle="Orders placed with an API key."
      action={
        <button
          type="button"
          data-testid="export-csv"
          data-emphasis="primary"
          className={primary}
          disabled={!ready}
          onClick={() => {
            if (ready) downloadCsv(apiOrdersCsv(ready));
          }}
        >
          Export CSV
        </button>
      }
    >
      <div className="overflow-x-auto" data-testid="api-orders">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="bg-[#fafbfc] text-left text-[12.5px] font-medium text-ink-muted">
              <th className="px-[18px] py-2.5">Order</th>
              <th className="px-[18px] py-2.5">Customer reference</th>
              <th className="px-[18px] py-2.5">Key</th>
              <th className="px-[18px] py-2.5">Pages</th>
              <th className="px-[18px] py-2.5">Status</th>
              <th className="px-[18px] py-2.5">Amount charged</th>
              <th className="px-[18px] py-2.5">Placed</th>
              <th className="px-[18px] py-2.5" />
            </tr>
          </thead>
          <tbody>
            <ApiOrderRows loaded={loaded} orders={orders} />
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ApiOrderRows({ loaded, orders }: { loaded: boolean; orders: Section<ApiOrder[]> | null }) {
  if (!loaded || !orders) {
    return (
      <tr>
        <td colSpan={8} className="px-[18px] py-[13px] text-ink-muted">
          Loading API orders…
        </td>
      </tr>
    );
  }
  if (orders.status === "unavailable") {
    return (
      <tr>
        <td colSpan={8} data-testid="api-orders-soon" className="px-[18px] py-[13px] text-ink-muted">
          API order history is coming soon.
        </td>
      </tr>
    );
  }
  if (orders.status === "error") {
    return (
      <tr>
        <td colSpan={8} data-testid="api-orders-error" className="px-[18px] py-[13px] text-[#b42318]">
          {orders.message}
        </td>
      </tr>
    );
  }
  if (orders.data.length === 0) {
    return (
      <tr>
        <td colSpan={8} data-testid="api-orders-empty" className="px-[18px] py-[13px] text-ink-muted">
          No API orders yet.
        </td>
      </tr>
    );
  }
  return orders.data.map((order) => {
    const href = safeOrderLink(order.downloadUrl) ?? safeOrderLink(order.viewUrl);
    const label = order.downloadUrl && safeOrderLink(order.downloadUrl) ? "Download" : "View";
    const keyLabel =
      order.keyPrefix && order.keyLast4 ? formatKeyPrefix(order.keyPrefix, order.keyLast4) : (order.keyName ?? "—");
    return (
      <tr key={order.id} data-testid={`api-order-${order.id}`} className="border-t border-line">
        <td className="px-[18px] py-[13px] font-semibold">{order.id}</td>
        <td className="px-[18px] py-[13px]">{order.externalRef ?? "—"}</td>
        <td className="px-[18px] py-[13px] font-mono text-[12.5px]">{keyLabel}</td>
        <td className="px-[18px] py-[13px]">{order.pages ?? "—"}</td>
        <td className="px-[18px] py-[13px]">{order.status}</td>
        <td className="px-[18px] py-[13px]">{formatCharged(order.amountCents, order.currency)}</td>
        <td className="px-[18px] py-[13px]">{formatPlaced(order.placedAt)}</td>
        <td className="px-[18px] py-[13px] text-right">
          {href ? (
            <a href={href} className="font-semibold text-primary" data-testid={`api-order-link-${order.id}`}>
              {label}
            </a>
          ) : (
            "—"
          )}
        </td>
      </tr>
    );
  });
}

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "api-orders.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function cardBadge(brand: string): string {
  const lower = brand.toLowerCase();
  if (lower === "visa") return "VISA";
  if (lower === "mastercard") return "MC";
  if (lower === "amex" || lower === "american express") return "AMEX";
  return brand.slice(0, 4).toUpperCase();
}

function cardBrand(brand: string): string {
  const known: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    amex: "American Express",
    discover: "Discover",
  };
  return known[brand.toLowerCase()] ?? (brand.charAt(0).toUpperCase() + brand.slice(1));
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
  setCardState: (state: Section<SavedCard | null>) => void,
  setNotice: (value: string | null) => void,
  setSetupSecret: (value: string | null) => void,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await client.loadCard();
    if (result.ok && result.data) {
      setCard(result.data);
      setCardState({ status: "ready", data: result.data });
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
