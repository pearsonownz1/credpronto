"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccountShell } from "@/components/account/account-shell";
import {
  WEBHOOK_EVENTS,
  getIntegrationsClient,
  type IntegrationsSnapshot,
  type WebhookEvent,
} from "@/lib/integrations/client";
import type { ApiResult } from "@/lib/api/types";
import {
  formatCardExpiry,
  formatCardLabel,
  formatKeyCreated,
  formatLastUsed,
  maskKey,
  maskWebhookSecret,
} from "@/lib/integrations/present";

const QUICK_START = `curl https://www.credpronto.com/api/v1/orders \\
  -H "Authorization: Bearer cp_live_…" \\
  -F file=@acta.pdf \\
  -F target=en`;

const secondary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-semibold text-ink";
const primary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-primary bg-primary px-3 py-[7px] text-[13px] font-semibold text-white";
const dangerButton =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-semibold text-[#b42318]";

export function IntegrationsPanel() {
  const { account, now } = useAccountShell();
  const client = getIntegrationsClient();
  const [snapshot, setSnapshot] = useState<IntegrationsSnapshot | null>(() => client.current(now));
  const [notice, setNotice] = useState<string | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (snapshot) return;
    let cancel = false;
    void getIntegrationsClient()
      .load(now)
      .then((result) => {
        if (cancel) return;
        if (result.ok) setSnapshot(result.data);
        else setNotice(result.error);
      });
    return () => {
      cancel = true;
    };
  }, [now, snapshot]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  async function run(id: string, action: () => Promise<ApiResult<IntegrationsSnapshot>>) {
    setBusy(id);
    setNotice(null);
    const result = await action();
    setBusy(null);
    if (result.ok) setSnapshot(result.data);
    else setNotice(result.error);
  }

  async function copyKey() {
    const secret = snapshot?.revealed?.secret;
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Couldn't copy the key.");
    }
  }

  async function revealSecret() {
    if (webhookSecret) {
      setWebhookSecret(null);
      return;
    }
    setBusy("reveal");
    const result = await client.revealWebhookSecret(now);
    setBusy(null);
    if (result.ok) setWebhookSecret(result.data.secret);
    else setNotice(result.error);
  }

  if (!snapshot) {
    return (
      <section data-testid="integrations" className="min-w-0">
        <h1 className="text-[26px] tracking-[-0.6px]">Integrations</h1>
        <p className="mt-2 text-sm text-ink-muted" data-testid="integrations-notice">
          {notice ?? "Loading integrations…"}
        </p>
      </section>
    );
  }

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
                disabled={busy === "create"}
                onClick={() => void run("create", () => client.createKey(now))}
              >
                + Create key
              </button>
            }
          >
            {snapshot.revealed ? (
              <div data-testid="new-key" className="border-b border-[#c9d6ff] bg-[#f7f9ff] px-[18px] py-3 text-[13px]">
                <p>
                  <span className="font-semibold">New key &quot;{snapshot.revealed.name}&quot; created.</span> Copy it now.
                  You won&apos;t see it again.
                </p>
                <div className="mt-2 flex h-[38px] items-center justify-between gap-3 rounded-[var(--cp-radius)] border border-line bg-white px-3 font-mono text-[12.5px]">
                  <span data-testid="new-key-secret" className="min-w-0 truncate">
                    {snapshot.revealed.secret}
                  </span>
                  <button type="button" data-testid="copy-key" className="shrink-0 font-sans text-[13px] font-semibold text-primary" onClick={() => void copyKey()}>
                    {copied ? "Copied" : "Copy"}
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
                    <th className="px-[18px] py-2.5">Last used</th>
                    <th className="px-[18px] py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {snapshot.keys.map((key) => (
                    <tr key={key.id} data-testid={`key-${key.id}`} className="border-t border-line">
                      <td className="px-[18px] py-[13px] font-semibold">{key.name}</td>
                      <td className="px-[18px] py-[13px] font-mono text-[12.5px]" data-testid={`key-mask-${key.id}`}>
                        {maskKey(key.prefix, key.last4)}
                      </td>
                      <td className="px-[18px] py-[13px]">{formatKeyCreated(key.createdAt)}</td>
                      <td className="px-[18px] py-[13px]">{formatLastUsed(key.lastUsedAt, now)}</td>
                      <td className="px-[18px] py-[13px] text-right">
                        <button
                          type="button"
                          data-testid={`revoke-${key.id}`}
                          aria-label={`Revoke ${key.name}`}
                          className="text-[13px] font-semibold text-[#b42318]"
                          onClick={() => void run(key.id, () => client.revokeKey(key.id, now))}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
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
                data-testid="send-test"
                className={secondary}
                disabled={busy === "test"}
                onClick={() => void run("test", () => client.sendTest(now))}
              >
                Send test
              </button>
            }
          >
            <div className="px-[18px] py-4 text-[13.5px]">
              <p className="mb-1.5 text-[12.5px] text-ink-muted">Endpoint URL</p>
              <div className="flex h-[38px] items-center justify-between gap-3 rounded-[var(--cp-radius)] border border-line px-3 font-mono text-[12.5px]">
                <span data-testid="webhook-url" className="min-w-0 truncate">
                  {snapshot.webhook.url}
                </span>
                <span data-testid="webhook-result" data-sent={String(snapshot.webhook.sentCount)} className="shrink-0 font-sans text-[13px] font-semibold text-[#12805c]">
                  ● {snapshot.webhook.lastLabel}
                </span>
              </div>
              <p className="mt-3.5 mb-1.5 text-[12.5px] text-ink-muted">Signing secret</p>
              <div className="flex h-[38px] items-center justify-between gap-3 rounded-[var(--cp-radius)] border border-line px-3 font-mono text-[12.5px]">
                <span data-testid="webhook-secret" className="min-w-0 truncate">
                  {webhookSecret ?? maskWebhookSecret(snapshot.webhook.secretLast4)}
                </span>
                <button type="button" data-testid="reveal-secret" className="shrink-0 font-sans text-[13px] font-semibold text-primary" onClick={() => void revealSecret()}>
                  {webhookSecret ? "Hide" : "Reveal"}
                </button>
              </div>
              <p className="mt-3.5 mb-1.5 text-[12.5px] text-ink-muted">Events</p>
              <div>
                {WEBHOOK_EVENTS.map((event) => (
                  <EventChip
                    key={event}
                    event={event}
                    on={snapshot.webhook.events.includes(event)}
                    onToggle={() => void run(event, () => client.toggleEvent(event, now))}
                  />
                ))}
              </div>
            </div>
          </Panel>
        </div>
        <div className="min-w-0">
          <Panel title="Billing for API orders" subtitle="Charged automatically when an order is placed.">
            <div className="px-[18px] py-4">
              {snapshot.card ? (
                <div data-testid="saved-card" className="flex flex-wrap items-center gap-3 rounded-[var(--cp-radius)] border border-line p-3">
                  <span className="inline-flex h-7 w-[42px] items-center justify-center rounded-[var(--cp-radius)] bg-[#1a1f71] text-[11px] font-bold text-white">
                    {snapshot.card.brand === "Visa" ? "VISA" : "MC"}
                  </span>
                  <span>
                    <span className="block text-[13.5px] font-semibold">{formatCardLabel(snapshot.card.brand, snapshot.card.last4)}</span>
                    <span className="block text-[12.5px] text-ink-muted">
                      {formatCardExpiry(snapshot.card.expMonth, snapshot.card.expYear)}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-testid="replace-card"
                    className={`${secondary} ml-auto`}
                    onClick={() => void run("replace", () => client.replaceCard(now))}
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <div data-testid="saved-card-empty" className="flex items-center justify-between gap-3">
                  <p className="text-[13.5px] text-ink-muted">No card on file.</p>
                  <button type="button" data-testid="replace-card" className={secondary} onClick={() => void run("replace", () => client.replaceCard(now))}>
                    Replace
                  </button>
                </div>
              )}
              <p className="mt-2.5 text-[12.5px] text-ink-muted">
                Receipts go to {account.email}. Orders placed in the dashboard still check out normally.
              </p>
              {snapshot.card ? (
                <div className="mt-3">
                  <button type="button" data-testid="remove-card" className={dangerButton} onClick={() => void run("remove", () => client.removeCard(now))}>
                    Remove card
                  </button>
                </div>
              ) : null}
            </div>
          </Panel>
          <Panel title="Quick start" subtitle="Place an order with one call.">
            <div className="px-[18px] py-4">
              <pre data-testid="quick-start" className="overflow-x-auto rounded-[var(--cp-radius)] bg-[#0b1220] p-4 font-mono text-[11.5px] leading-[1.6] whitespace-pre text-[#d6e0ff]">
                {QUICK_START}
              </pre>
            </div>
          </Panel>
        </div>
      </div>
    </section>
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

function EventChip({ event, on, onToggle }: { event: WebhookEvent; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid={`event-${event}`}
      aria-pressed={on}
      onClick={onToggle}
      className={`mb-1.5 mr-1.5 inline-block rounded-full border px-[9px] py-[3px] font-mono text-[11.5px] ${
        on ? "border-[#c9d6ff] bg-[#eaf0ff] text-primary" : "border-line bg-white text-ink"
      }`}
    >
      {event}
    </button>
  );
}
