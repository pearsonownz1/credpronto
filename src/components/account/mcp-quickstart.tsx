"use client";

import { useEffect, useState } from "react";
import { formatKeyPrefix, formatLastUsed } from "@/lib/integrations/present";
import { MCP_ENDPOINT } from "@/lib/mcp/catalog";
import { MCP_CONFIG_TABS, configFor } from "@/lib/mcp/quickstart";
import { MCP_TOOL_DOCS } from "@/lib/mcp/docs";

type McpKey = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const primary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-primary bg-primary px-3 py-[7px] text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60";
const secondary =
  "inline-flex items-center rounded-[var(--cp-radius)] border border-line bg-white px-3 py-[7px] text-[13px] font-medium text-ink";

export function McpQuickstart() {
  const [tab, setTab] = useState<(typeof MCP_CONFIG_TABS)[number]["id"]>("claude");
  const [keys, setKeys] = useState<McpKey[] | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [name, setName] = useState("MCP");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancel = false;
    void fetch("/api/me/mcp-keys")
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { keys?: McpKey[]; error?: string } | null;
        if (cancel) return;
        if (!response.ok || !body?.keys) {
          setNotice(body?.error ?? "Couldn't load API keys.");
          setKeys([]);
          return;
        }
        setKeys(body.keys);
      })
      .catch(() => {
        if (!cancel) setNotice("Couldn't load API keys.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
    } catch {
      setNotice("Couldn't copy that.");
    }
  }

  async function createKey() {
    setBusy("create");
    setNotice(null);
    const response = await fetch("/api/me/mcp-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "MCP" }),
    });
    const body = (await response.json().catch(() => null)) as (McpKey & { secret?: string; error?: string }) | null;
    setBusy(null);
    if (!response.ok || !body?.secret || !body.id) {
      setNotice(body?.error ?? "Couldn't create an API key.");
      return;
    }
    setSecret(body.secret);
    setKeys((current) => [body, ...(current ?? []).filter((key) => key.id !== body.id)]);
  }

  async function revoke(id: string) {
    setBusy(id);
    setNotice(null);
    const response = await fetch(`/api/me/mcp-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = (await response.json().catch(() => null)) as { revokedAt?: string | null; error?: string } | null;
    setBusy(null);
    if (!response.ok) {
      setNotice(body?.error ?? "Couldn't revoke that key.");
      return;
    }
    setKeys((current) =>
      (current ?? []).map((key) => (key.id === id ? { ...key, revokedAt: body?.revokedAt ?? new Date().toISOString() } : key)),
    );
    if (secret) setSecret(null);
  }

  const snippet = configFor(tab, secret ?? undefined);
  const active = MCP_CONFIG_TABS.find((item) => item.id === tab) ?? MCP_CONFIG_TABS[0];

  return (
    <section data-testid="mcp-quickstart" className="min-w-0 font-normal">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-medium tracking-[-0.6px]">MCP quickstart</h1>
          <p className="mt-1 text-sm font-normal text-ink-muted">
            Order and track certified translations and credential evaluations from an AI agent.
          </p>
        </div>
        <button type="button" data-testid="create-mcp-key" className={primary} disabled={busy === "create"} onClick={() => void createKey()}>
          Create API key
        </button>
      </div>
      {notice ? (
        <p data-testid="mcp-notice" className="mb-4 text-sm text-[#b42318]">
          {notice}
        </p>
      ) : null}
      {secret ? (
        <p data-testid="mcp-secret" className="mb-4 rounded-[var(--cp-radius)] border border-line bg-white px-4 py-3 font-mono text-[12.5px]">
          Copy this key now. It is shown once.
          <span className="mt-1 block break-all">{secret}</span>
        </p>
      ) : null}
      <div className="grid min-w-0 items-start gap-[18px] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="min-w-0">
          <section className="mb-[18px] rounded-[var(--cp-radius)] border border-line bg-white">
            <header className="flex items-center justify-between gap-3 border-b border-line px-[18px] py-3.5">
              <h2 className="text-[15px] font-medium">Endpoint</h2>
              <button type="button" data-testid="copy-endpoint" className="text-[13px] font-medium text-primary" onClick={() => void copy("endpoint", MCP_ENDPOINT)}>
                {copied === "endpoint" ? "Copied" : "Copy"}
              </button>
            </header>
            <div className="px-[18px] py-4">
              <p data-testid="mcp-endpoint" className="break-all font-mono text-[13px]">
                {MCP_ENDPOINT}
              </p>
              <p className="mt-1 text-[12.5px] text-ink-muted">Streamable HTTP · API key in Authorization: Bearer</p>
            </div>
          </section>
          <section className="rounded-[var(--cp-radius)] border border-line bg-white">
            <header className="border-b border-line px-[18px] py-3.5">
              <h2 className="text-[15px] font-medium">Tools</h2>
            </header>
            <div className="overflow-x-auto">
              <table data-testid="mcp-tools" className="w-full border-collapse text-[13.5px]">
                <tbody>
                  {MCP_TOOL_DOCS.map((tool) => (
                    <tr key={tool.name} className="border-t border-line first:border-t-0">
                      <td className="px-[18px] py-2.5 align-top font-mono text-[12.5px]">{tool.name}</td>
                      <td className="px-[18px] py-2.5 text-ink-muted">{tool.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <section className="min-w-0 rounded-[var(--cp-radius)] border border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line px-[18px] pt-3">
            <div className="flex gap-4" role="tablist">
              {MCP_CONFIG_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  data-testid={`mcp-tab-${item.id}`}
                  className={`border-b-2 pb-2 text-[13.5px] font-medium ${tab === item.id ? "border-ink text-ink" : "border-transparent text-ink-muted"}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button type="button" data-testid="copy-config" className={secondary} onClick={() => void copy("config", snippet)}>
              {copied === "config" ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="px-[18px] py-4">
            <p className="mb-2 text-[12.5px] text-ink-muted">Add to {active.filename}</p>
            <pre data-testid="mcp-config" className="overflow-x-auto rounded-[var(--cp-radius)] bg-[#f6f7f9] p-3 font-mono text-[12px] leading-relaxed">
              {snippet}
            </pre>
          </div>
        </section>
      </div>
      <section className="mt-[18px] rounded-[var(--cp-radius)] border border-line bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-[18px] py-3.5">
          <div>
            <h2 className="text-[15px] font-medium">API keys</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">The full key is shown once. Each key is limited to this account.</p>
          </div>
          <label className="text-[12.5px] text-ink-muted">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-testid="mcp-key-name"
              className="ml-2 h-[34px] rounded-[var(--cp-radius)] border border-line px-2 font-normal text-ink"
            />
          </label>
        </header>
        <ul data-testid="mcp-keys" className="divide-y divide-line">
          {(keys ?? []).filter((key) => !key.revokedAt).length === 0 ? (
            <li className="px-[18px] py-3 text-[13.5px] text-ink-muted">{keys ? "No API keys yet." : "Loading keys…"}</li>
          ) : (
            (keys ?? [])
              .filter((key) => !key.revokedAt)
              .map((key) => (
                <li key={key.id} data-testid={`mcp-key-${key.id}`} className="flex flex-wrap items-center gap-3 px-[18px] py-3 text-[13.5px]">
                  <span className="font-medium">{key.name}</span>
                  <span className="font-mono text-[12.5px]">{formatKeyPrefix(key.prefix, key.last4)}</span>
                  <span className="text-ink-muted">Last used {formatLastUsed(key.lastUsedAt, now)}</span>
                  <button type="button" className={`${secondary} ml-auto`} disabled={busy === key.id} onClick={() => void revoke(key.id)}>
                    Revoke
                  </button>
                </li>
              ))
          )}
        </ul>
      </section>
    </section>
  );
}
